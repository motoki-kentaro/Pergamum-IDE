import {
  runtimeActionFingerprint,
  sameRuntimeProjectContext,
  type RuntimeProjectContext,
  type RuntimeLocalActionRequest,
  type RuntimeLocalActionResult,
} from "../shared/runtimeLaunchAction";
import type {
  AppConfirmDialogOptions,
  AppConfirmDialogResult,
} from "./dialog/appDialogTypes";
import type { DialogControllerPendingRequest } from "./dialog/dialogController";

/** Reuses document lifecycles supplied by App; ownership classification is
 * already authoritative in Main, not reconstructed from Renderer tab state.
 */
export function createRuntimeMarkdownLocalHandler(options: {
  readonly isReady: () => boolean;
  readonly getContext: () => Promise<RuntimeProjectContext>;
  readonly openStandalone: (filePath: string) => Promise<boolean>;
  readonly openProjectDocument: (relativePath: string) => Promise<boolean>;
  readonly promoteProject: (
    projectFilePath: string,
    filePath: string,
  ) => Promise<RuntimeLocalActionResult>;
  readonly reject: (
    reason: Extract<
      RuntimeLocalActionRequest["action"],
      { kind: "reject" }
    >["reason"],
  ) => boolean;
}) {
  return async (
    request: RuntimeLocalActionRequest,
  ): Promise<RuntimeLocalActionResult> => {
    if (!options.isReady()) return { kind: "retryLater" };
    if (
      !sameRuntimeProjectContext(
        request.expectedContext,
        await options.getContext(),
      ) ||
      !options.isReady()
    )
      return { kind: "retryLater" };
    const action = request.action;
    if (
      (action.kind === "standalone" || action.kind === "promoteProject") &&
      request.expectedContext.projectId !== null
    )
      return { kind: "retryLater" };
    if (
      action.kind === "projectDocument" &&
      request.expectedContext.projectId === null
    )
      return { kind: "retryLater" };
    switch (action.kind) {
      case "reject":
        return options.reject(action.reason)
          ? { kind: "rejected" }
          : { kind: "retryLater" };
      case "standalone":
        return (await options.openStandalone(action.filePath))
          ? { kind: "handled" }
          : { kind: "retryLater" };
      case "projectDocument":
        return (await options.openProjectDocument(action.relativePath))
          ? { kind: "handled" }
          : { kind: "retryLater" };
      case "promoteProject":
        return options.promoteProject(action.projectFilePath, action.filePath);
    }
  };
}
export function tryOwnRuntimeRejection(
  options: AppConfirmDialogOptions,
  dialog: {
    readonly confirm: (
      options: AppConfirmDialogOptions,
    ) => Promise<AppConfirmDialogResult>;
    readonly getPendingRequest: () => DialogControllerPendingRequest | null;
  },
): boolean {
  if (dialog.getPendingRequest()) return false;
  void dialog.confirm(options).catch(() => undefined);
  const pending = dialog.getPendingRequest();
  return pending?.kind === "confirm" && pending.options === options;
}

export const DEFAULT_RUNTIME_RENDERER_ACTION_POLICY = {
  maxRememberedActions: 256,
};
/** In-flight and completed results are shared for this renderer lifetime.
 * Unacknowledged successes are never evicted: eviction could repeat an action
 * after an ACK loss. At capacity new work is deferred, never silently repeated.
 * Main releases a completed result only after verifying its ownership ACK.
 * Renderer replacement cannot provide a cross-lifetime delivery guarantee.
 */
export function createRuntimeMarkdownLocalReceiver(options: {
  readonly handle: (
    request: RuntimeLocalActionRequest,
  ) => Promise<RuntimeLocalActionResult>;
  /** Wake a retained deferred continuation, never restart the local action. */
  readonly retryInFlight?: (request: RuntimeLocalActionRequest) => void;
  readonly policy?: typeof DEFAULT_RUNTIME_RENDERER_ACTION_POLICY;
}) {
  const max =
    options.policy?.maxRememberedActions ??
    DEFAULT_RUNTIME_RENDERER_ACTION_POLICY.maxRememberedActions;
  if (!Number.isSafeInteger(max) || max <= 0)
    throw new Error("Invalid renderer action policy.");
  const remembered = new Map<
    string,
    {
      fingerprint: string;
      result: Promise<RuntimeLocalActionResult>;
      settled: boolean;
      canRetry: boolean;
    }
  >();
  function run(
    request: RuntimeLocalActionRequest,
    fingerprint: string,
  ): Promise<RuntimeLocalActionResult> {
    let uncertain = false;
    const result = Promise.resolve()
      .then(() => options.handle(request))
      .catch((): RuntimeLocalActionResult => {
        // A throw may follow an effect. Preserve the inconclusive result.
        uncertain = true;
        return { kind: "retryLater" };
      })
      .then((result) => {
        const entry = remembered.get(request.requestId);
        if (entry) {
          entry.settled = true;
          // Keep the fingerprint even when retry is safe: a different action
          // using the same requestId must still be rejected as a conflict.
          entry.canRetry = result.kind === "retryLater" && !uncertain;
        }
        return result;
      });
    remembered.set(request.requestId, {
      fingerprint,
      result,
      settled: false,
      canRetry: false,
    });
    return result;
  }
  return {
    release(requestId: string): void {
      // Release messages come only from Main after a matching successful ACK.
      const entry = remembered.get(requestId);
      if (entry)
        void entry.result.then((result) => {
          if (result.kind === "handled" || result.kind === "rejected")
            remembered.delete(requestId);
        });
    },
    receive(
      request: RuntimeLocalActionRequest,
    ): Promise<RuntimeLocalActionResult> {
      const fingerprint = runtimeActionFingerprint(request);
      const existing = remembered.get(request.requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          return Promise.resolve({ kind: "conflict" });
        if (existing.canRetry) return run(request, fingerprint);
        if (!existing.settled) options.retryInFlight?.(request);
        return existing.result;
      }
      if (remembered.size >= max)
        return Promise.resolve({ kind: "retryLater" });
      return run(request, fingerprint);
    },
  };
}
