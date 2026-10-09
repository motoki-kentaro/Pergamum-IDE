import { app, ipcMain } from "electron";
import { JAPANESE_LINT_CHANNELS } from "../shared/api";
import {
  parseJapaneseLintRequest,
  type JapaneseLintEngineNotice,
  type JapaneseLintRequest,
  type JapaneseLintResponse
} from "../shared/japaneseLint";
import { formatJapaneseLintEngineTechnicalInfo } from "../shared/japaneseLintEngineTechnicalInfo";
import { buildJapaneseLintWorkerConfig } from "../shared/japaneseLintWorkerProtocol";
import { getDebugLogger, type DebugLogger } from "./debugLogger";
import { loadSettings } from "./settingsStore";
import {
  isJapaneseLintDictionaryMissing,
  JapaneseLintWorkerError,
  type JapaneseLintHost,
  type JapaneseLintHostExitInfo
} from "./linterWorker/japaneseLintHost";
import { createElectronJapaneseLintHost } from "./linterWorker/japaneseLintHostElectron";

/**
 * #625: the instant Japanese expression check. The request is validated
 * (untrusted input) and the lint itself runs in the utilityProcess Worker
 * (see linterWorker/), never in the Main Process: textlint's cost grows
 * faster than linearly and would otherwise freeze the window.
 *
 * The Renderer contract is unchanged: `{ ok: true, diagnostics, truncated }`
 * or `{ ok: false, reason }`. A missing dictionary stays identifiable so the
 * Renderer can stop checking and explain recovery. Other Worker failures
 * fold into `lint-failed`. This handler never rejects.
 *
 * Lifecycle: the Worker starts lazily on the first lint that has something to
 * run (a document of any length: there is no size limit, the Worker keeps
 * the Main Process free) and is reused afterwards. `release()` (Linter OFF, project close, app
 * quit) disposes it; the next lint starts a fresh one. Body text is never
 * logged - only sizes, timings and counts.
 */

/** Supplies the stored `japaneseLint` settings; read fresh per request. */
export type JapaneseLintSettingsProvider = () => Promise<unknown>;

const loadStoredJapaneseLintSettings: JapaneseLintSettingsProvider = async () =>
  (await loadSettings()).japaneseLint;

export interface InstantJapaneseLintDeps {
  createHost(
    getSettings: () => unknown,
    hooks?: { onExit?(info: JapaneseLintHostExitInfo): void }
  ): JapaneseLintHost;
  settingsProvider: JapaneseLintSettingsProvider;
  logger: Pick<DebugLogger, "log">;
  /** For the copyable technical information (#778). */
  getEnvironment?(): { appVersion: string; platform: string };
}

export interface InstantJapaneseLintService {
  lint(rawRequest: unknown): Promise<JapaneseLintResponse>;
  /** Linter OFF / project close / app quit: stops the Worker. Never rejects. */
  release(): Promise<void>;
}

function countLines(text: string): number {
  let lines = 1;

  for (let index = text.indexOf("\n"); index !== -1; ) {
    lines += 1;
    index = text.indexOf("\n", index + 1);
  }

  return lines;
}

/** #778: a start that cannot succeed on retry is not retried. */
function isRetryableStartError(error: unknown): boolean {
  return !(
    error instanceof JapaneseLintWorkerError &&
    (error.kind === "disposed" || error.kind === "invalid-argument")
  );
}

/** An enumerated failure kind only: a Worker's message text is never used. */
function describeStartFailure(error: unknown): string {
  if (error instanceof JapaneseLintWorkerError) {
    return error.workerError
      ? `${error.kind}:${error.workerError.kind}`
      : error.kind;
  }

  return "unknown";
}

type StartOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly attempts: number;
      readonly exhausted: boolean;
    };

type LintStage = "queued" | "dictionary-check" | "lint-running" | "completed";

export function createInstantJapaneseLintService(
  deps: InstantJapaneseLintDeps
): InstantJapaneseLintService {
  let host: JapaneseLintHost | null = null;
  // The settings the running Worker was last given (init or updateConfig).
  let appliedConfigKey: string | null = null;
  // The settings the current request read; also what a (re)start inits with.
  let latestStored: unknown;
  // Jobs of this Instant Linter session that the Worker has not begun yet.
  const jobStages = new Map<string, LintStage>();
  // #778: one start sequence = Linter ON until release(). The engine notice
  // is handed to the first response after a successful start, once.
  let engineAnnounced = false;
  let pendingEngineNotice: JapaneseLintEngineNotice | null = null;
  let startSequence: Promise<StartOutcome> | null = null;
  let lastExit: JapaneseLintHostExitInfo | null = null;

  // 1 initial start + `workerRestartAttempts` restarts, retried at once. A
  // missing dictionary (#775) and errors no retry can fix end it immediately.
  const runStartAttempts = async (
    activeHost: JapaneseLintHost,
    restartAttempts: number
  ): Promise<StartOutcome> => {
    const maxAttempts = 1 + restartAttempts;
    let attempts = 0;

    lastExit = null;

    for (;;) {
      attempts += 1;

      try {
        await activeHost.start();

        if (attempts > 1) {
          pendingEngineNotice = "restarted";
        } else if (!engineAnnounced) {
          pendingEngineNotice = "started";
        }

        engineAnnounced = true;

        return { ok: true };
      } catch (error) {
        if (
          isJapaneseLintDictionaryMissing(error) ||
          !isRetryableStartError(error)
        ) {
          return { ok: false, error, attempts, exhausted: false };
        }

        if (attempts >= maxAttempts) {
          return { ok: false, error, attempts, exhausted: true };
        }
      }
    }
  };

  // Concurrent lints share one sequence instead of multiplying the attempts.
  const ensureStarted = (
    activeHost: JapaneseLintHost,
    restartAttempts: number
  ): Promise<StartOutcome> => {
    startSequence ??= runStartAttempts(activeHost, restartAttempts).finally(
      () => {
        startSequence = null;
      }
    );

    return startSequence;
  };

  const engineUnavailable = (
    activeHost: JapaneseLintHost,
    outcome: Extract<StartOutcome, { ok: false }>,
    restartAttempts: number
  ): JapaneseLintResponse => {
    const environment = deps.getEnvironment?.() ?? {
      appVersion: "unknown",
      platform: process.platform
    };

    return {
      ok: false,
      reason: "engine-unavailable",
      technicalInfo: formatJapaneseLintEngineTechnicalInfo({
        appVersion: environment.appVersion,
        platform: environment.platform,
        engineState: activeHost.getState(),
        attempts: outcome.attempts,
        workerRestartAttempts: restartAttempts,
        lastFailureKind: describeStartFailure(outcome.error),
        ...(lastExit ? { exitCode: lastExit.code, exitSignal: lastExit.signal } : {})
      })
    };
  };

  const cancelSuperseded = (activeHost: JapaneseLintHost): void => {
    for (const [jobId, stage] of jobStages) {
      // A job textlint is already running cannot be interrupted; cancelling
      // it would end the whole Worker (and the new job with it). Its result
      // is simply discarded by the Renderer's stale-result guard.
      if (stage === "queued" || stage === "dictionary-check") {
        jobStages.delete(jobId);
        void activeHost.cancel(jobId).catch(() => undefined);
      }
    }
  };

  // Handed out once: later responses of the same sequence carry none.
  const engineNoticeField = (): { engineNotice?: JapaneseLintEngineNotice } => {
    const notice = pendingEngineNotice;

    pendingEngineNotice = null;

    return notice === null ? {} : { engineNotice: notice };
  };

  const lint = async (rawRequest: unknown): Promise<JapaneseLintResponse> => {
    const startedAt = Date.now();
    let request: JapaneseLintRequest | null = null;

    // Logging must never throw into the handler.
    const logRun = (
      result: "succeeded" | "failed",
      extra: {
        reason?: "lint_failed" | "validation_failed";
        count?: number;
        failureReason?: "dictionary-missing" | "lint-failed" | "canceled" | "worker-failed";
        enabledRuleIds?: readonly string[];
        truncated?: boolean;
      }
    ): void => {
      try {
        const { count, ...rest } = extra;

        deps.logger.log({
          level: "debug",
          event: "japaneseLint.run.completed",
          details: {
            linterMode: "instant-worker",
            result,
            ...rest,
            ...(count !== undefined
              ? { count, totalMessages: count, returnedMessages: count }
              : {}),
            ...(request
              ? {
                  characterLength: request.text.length,
                  lineCount: countLines(request.text),
                  lintFormat: request.format,
                  extension: request.ext
                }
              : {}),
            durationMs: Date.now() - startedAt
          }
        });
      } catch {
        /* diagnostics only */
      }
    };

    try {
      request = parseJapaneseLintRequest(rawRequest);

      if (request === null) {
        logRun("failed", { reason: "validation_failed" });

        return { ok: false, reason: "invalid-request" };
      }

      try {
        latestStored = await deps.settingsProvider();
      } catch {
        latestStored = undefined;
      }

      const config = buildJapaneseLintWorkerConfig(latestStored);

      // Every rule switched off: nothing to check, so no Worker is started.
      if (config.rules.length === 0) {
        logRun("succeeded", { count: 0, enabledRuleIds: [] });

        return { ok: true, diagnostics: [], truncated: false };
      }

      if (host === null) {
        host = deps.createHost(() => latestStored, {
          onExit: (info) => {
            lastExit = info;
          }
        });
        appliedConfigKey = null;
      }

      const activeHost = host;
      const configKey = JSON.stringify(config);

      if (activeHost.getState() !== "ready") {
        // (Re)starting inits the Worker with the settings just read.
        const started = await ensureStarted(
          activeHost,
          config.workerRestartAttempts
        );

        if (!started.ok) {
          if (!started.exhausted) {
            throw started.error;
          }

          logRun("failed", {
            reason: "lint_failed",
            failureReason: "worker-failed",
            enabledRuleIds: config.enabledRuleIds
          });

          return engineUnavailable(
            activeHost,
            started,
            config.workerRestartAttempts
          );
        }

        appliedConfigKey = configKey;
      } else if (appliedConfigKey !== configKey) {
        await activeHost.updateConfig(config);
        appliedConfigKey = configKey;
      }

      cancelSuperseded(activeHost);

      const jobId = activeHost.createJobId();

      jobStages.set(jobId, "queued");

      const outcome = await activeHost.lintDocument({
        source: request.text,
        format: request.format,
        ext: request.ext,
        jobId,
        onProgress: (progress) => {
          if (jobStages.has(jobId)) {
            jobStages.set(jobId, progress.stage);
          }
        }
      });

      jobStages.delete(jobId);

      if (!outcome.ok) {
        logRun("failed", {
          reason: "lint_failed",
          failureReason: outcome.reason,
          enabledRuleIds: config.enabledRuleIds
        });

        return {
          ok: false,
          reason: outcome.reason === "dictionary-missing"
            ? "dictionary-missing"
            : "lint-failed"
        };
      }

      logRun("succeeded", {
        count: outcome.messages.length,
        truncated: outcome.truncated,
        enabledRuleIds: config.enabledRuleIds
      });

      return {
        ok: true,
        diagnostics: outcome.messages.map((message) => ({
          ruleId: message.ruleId,
          severity: message.severity,
          message: message.message,
          line: message.line,
          column: message.column,
          index: message.index
        })),
        truncated: outcome.truncated,
        ...engineNoticeField()
      };
    } catch (error) {
      // start() / updateConfig() failing (e.g. a missing Worker bundle).
      const missing = isJapaneseLintDictionaryMissing(error);
      logRun("failed", {
        reason: "lint_failed",
        failureReason: missing ? "dictionary-missing" : "worker-failed"
      });

      return { ok: false, reason: missing ? "dictionary-missing" : "lint-failed" };
    }
  };

  const release = async (): Promise<void> => {
    const released = host;

    host = null;
    appliedConfigKey = null;
    jobStages.clear();
    engineAnnounced = false;
    pendingEngineNotice = null;

    if (released === null) {
      return;
    }

    try {
      await released.dispose();
    } catch {
      /* the Worker is being thrown away anyway */
    }
  };

  return { lint, release };
}

let service: InstantJapaneseLintService | null = null;

function getInstantJapaneseLintService(): InstantJapaneseLintService {
  service ??= createInstantJapaneseLintService({
    createHost: (getSettings, hooks) =>
      createElectronJapaneseLintHost({
        logger: getDebugLogger(),
        getSettings,
        ...(hooks?.onExit ? { onExit: hooks.onExit } : {})
      }),
    getEnvironment: () => ({
      appVersion: app.getVersion(),
      platform: process.platform
    }),
    settingsProvider: loadStoredJapaneseLintSettings,
    logger: getDebugLogger()
  });

  return service;
}

/** Linter OFF / project close / app quit. Safe to call at any time. */
export function releaseJapaneseLintWorker(): Promise<void> {
  return service === null ? Promise.resolve() : service.release();
}

export function registerJapaneseLintIpc(): void {
  ipcMain.handle(JAPANESE_LINT_CHANNELS.lint, async (_event, rawRequest) =>
    getInstantJapaneseLintService().lint(rawRequest)
  );
  ipcMain.handle(JAPANESE_LINT_CHANNELS.release, async () => {
    await releaseJapaneseLintWorker();
  });
}
