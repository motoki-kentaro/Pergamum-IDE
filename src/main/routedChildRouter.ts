import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createUuidv7, isUuidv7 } from "../shared/uuidv7";
import {
  parseRuntimeLaunch,
  ROUTED_LAUNCH_MARKER,
} from "./runtimeLaunchRouting";
import {
  childEnvironment,
  childClaimProof,
  matchesChildProof,
  validChildClaim,
  type RoutedChildMetadata,
} from "./routedChildClaim";
import type { QueuedRuntimeLaunch } from "./runtimeLaunchQueue";

export const DEFAULT_ROUTED_CHILD_POLICY = {
  claimTimeoutMs: 15000,
  maxAttempts: 128,
  completedTtlMs: 60000,
  maxCompleted: 256,
};
export type ChildRouteResult = {
  kind:
    "claimed" | "failedBeforeClaim" | "uncertain" | "conflict" | "unavailable";
};
export interface SpawnedRoutedChild {
  readonly pid?: number;
  once(event: "error" | "exit", listener: () => void): unknown;
}
/** Shell-free argv: preserve spaces, Japanese and shell punctuation as data. */
export function spawnRoutedProcess(options: {
  executable: string;
  appPath: string;
  packaged: boolean;
  target: string;
  metadata: RoutedChildMetadata;
  environment: NodeJS.ProcessEnv;
}): SpawnedRoutedChild {
  const child = spawn(
    options.executable,
    [
      ...(options.packaged ? [] : [options.appPath]),
      ROUTED_LAUNCH_MARKER,
      options.target,
    ],
    {
      shell: false,
      windowsVerbatimArguments: false,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: childEnvironment(options.environment, options.metadata),
    },
  );
  child.unref();
  return child;
}
export function createRoutedChildRouter(options: {
  parentInstanceRunId: string;
  endpoint: () => string | null;
  spawn: (target: string, metadata: RoutedChildMetadata) => SpawnedRoutedChild;
  now: () => number;
  onClaimed: () => void;
  policy?: typeof DEFAULT_ROUTED_CHILD_POLICY;
}) {
  const policy = options.policy ?? DEFAULT_ROUTED_CHILD_POLICY;
  if (Object.values(policy).some((v) => !Number.isSafeInteger(v) || v <= 0))
    throw new Error("Invalid child policy.");
  type Attempt = {
    target: string;
    metadata: RoutedChildMetadata;
    pid?: number;
    state: ChildRouteResult["kind"] | "inFlight";
    promise: Promise<ChildRouteResult>;
    resolve: (r: ChildRouteResult) => void;
    timer: ReturnType<typeof setTimeout>;
    completedAt?: number;
  };
  const attempts = new Map<string, Attempt>();
  let stopping = false;
  function prune() {
    const completed = [...attempts].filter(
      ([, a]) => a.state === "claimed" && a.completedAt !== undefined,
    );
    for (const [id, a] of completed)
      if (options.now() - a.completedAt! >= policy.completedTtlMs)
        attempts.delete(id);
    const retained = [...attempts].filter(
      ([, a]) => a.state === "claimed" && a.completedAt !== undefined,
    );
    while (retained.length > policy.maxCompleted)
      attempts.delete(retained.shift()![0]);
  }
  function route(entry: QueuedRuntimeLaunch): Promise<ChildRouteResult> {
    prune();
    const existing = attempts.get(entry.requestId);
    if (existing)
      return existing.target !== entry.target
        ? Promise.resolve({ kind: "conflict" })
        : existing.state === "inFlight"
          ? existing.promise
          : Promise.resolve({ kind: existing.state });
    const endpoint = options.endpoint();
    if (
      stopping ||
      !endpoint ||
      [...attempts.values()].filter((a) => a.state !== "claimed").length >=
        policy.maxAttempts
    )
      return Promise.resolve({ kind: "unavailable" });
    const parsed = parseRuntimeLaunch(["pergamum", entry.target], {
      isPackaged: true,
    });
    if (
      !isUuidv7(entry.requestId) ||
      parsed.kind !== "launch" ||
      !path.isAbsolute(entry.target) ||
      entry.target.length > 2048 ||
      entry.target.includes("\0")
    )
      return Promise.resolve({ kind: "conflict" });
    const metadata: RoutedChildMetadata = {
      requestId: entry.requestId,
      attemptId: createUuidv7(),
      parentInstanceRunId: options.parentInstanceRunId,
      endpoint,
      nonce: randomBytes(32).toString("hex"),
      secret: randomBytes(32).toString("hex"),
    };
    let resolve!: Attempt["resolve"];
    const promise = new Promise<ChildRouteResult>((r) => {
      resolve = r;
    });
    const finish = (kind: "uncertain" | "failedBeforeClaim") => {
      if (attempt.state !== "inFlight") return;
      attempt.state = kind;
      clearTimeout(attempt.timer);
      resolve({ kind });
    };
    const attempt: Attempt = {
      target: entry.target,
      metadata,
      state: "inFlight",
      promise,
      resolve,
      timer: setTimeout(() => finish("uncertain"), policy.claimTimeoutMs),
    };
    attempts.set(entry.requestId, attempt);
    try {
      const child = options.spawn(entry.target, metadata);
      attempt.pid = child.pid;
      child.once("error", () =>
        finish(child.pid ? "uncertain" : "failedBeforeClaim"),
      );
      // Exit without a recorded claim cannot prove the child never owned it.
      child.once("exit", () => finish("uncertain"));
    } catch {
      finish("failedBeforeClaim");
    }
    return promise;
  }
  return {
    route,
    receiveClaim(value: unknown): Record<string, unknown> | null {
      if (!validChildClaim(value)) return null;
      const a = attempts.get(value.requestId);
      if (
        !a ||
        a.state === "failedBeforeClaim" ||
        value.attemptId !== a.metadata.attemptId ||
        value.parentInstanceRunId !== options.parentInstanceRunId ||
        value.childPid !== a.pid ||
        value.target !== a.target ||
        value.nonce !== a.metadata.nonce ||
        !matchesChildProof(
          value.proof,
          childClaimProof(a.metadata.secret, value),
        )
      )
        return null;
      // This record, not writing the response, transfers ownership. Demotion
      // has no bearing on an attempt for which this process retained ownership.
      if (a.state !== "claimed") {
        a.state = "claimed";
        clearTimeout(a.timer);
        a.resolve({ kind: "claimed" });
        options.onClaimed();
      }
      return {
        kind: "routedChildClaimResult",
        requestId: value.requestId,
        attemptId: value.attemptId,
        parentInstanceRunId: options.parentInstanceRunId,
        proof: childClaimProof(a.metadata.secret, value, true),
      };
    },
    /** Call only once the downstream sink is returning accepted to its queue.
     * Uncertain and still-owned claims never enter evictable recent history.
     */
    release(requestId: string) {
      const a = attempts.get(requestId);
      if (a?.state === "claimed") a.completedAt = options.now();
      prune();
    },
    stop() {
      stopping = true;
      for (const a of attempts.values()) {
        clearTimeout(a.timer);
        if (a.state === "inFlight") {
          a.state = "uncertain";
          a.resolve({ kind: "uncertain" });
        }
      }
    },
  };
}
