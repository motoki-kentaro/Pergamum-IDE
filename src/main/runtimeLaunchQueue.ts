import type {
  LaunchHandoffReceiver,
  ValidatedLaunchHandoff,
} from "./launchHandoff";
import { isUuidv7 } from "../shared/uuidv7";

export type RuntimeLaunchQueueState = "notReady" | "ready" | "stopping";
export interface QueuedRuntimeLaunch {
  readonly requestId: string;
  readonly target: string;
  readonly receivedAt: number;
}
export interface RuntimeLaunchQueuePolicy {
  readonly maxPendingLaunches: number;
  readonly completedHistoryTtlMs: number;
  readonly maxCompletedHistory: number;
}
export const DEFAULT_RUNTIME_LAUNCH_QUEUE_POLICY: RuntimeLaunchQueuePolicy = {
  maxPendingLaunches: 128,
  completedHistoryTtlMs: 60000,
  maxCompletedHistory: 256,
};
export type RuntimeLaunchEnqueueResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "notReadyForHandoff" }
  | {
      readonly kind: "rejected";
      readonly reason: "requestIdConflict" | "handlerRejected";
    };
/** accepted means the sink now owns the request, not merely that work started.
 * A sink that fails or throws must leave ownership with the queue.
 */
export type RuntimeLaunchDispatchSink = (
  request: QueuedRuntimeLaunch,
) => Promise<
  | { readonly kind: "accepted" }
  | { readonly kind: "temporaryFailure" }
  | { readonly kind: "rejected" }
>;
export interface RuntimeLaunchQueue {
  enqueue(request: ValidatedLaunchHandoff): RuntimeLaunchEnqueueResult;
  readonly receiver: LaunchHandoffReceiver;
  current(): {
    readonly state: RuntimeLaunchQueueState;
    readonly pending: readonly QueuedRuntimeLaunch[];
  };
  /** Explicitly resumes a stopped-on-failure drain; no automatic retry loop. */
  markReady(sink: RuntimeLaunchDispatchSink): Promise<void>;
  /** Synchronous committed-quit boundary; retains all untransferred entries. */
  stop(): void;
}
export function createRuntimeLaunchQueue(options: {
  readonly now: () => number;
  readonly policy?: RuntimeLaunchQueuePolicy;
  /** Recheck election authority before starting each downstream dispatch. */
  readonly canDispatch?: () => boolean;
}): RuntimeLaunchQueue {
  const policy = { ...(options.policy ?? DEFAULT_RUNTIME_LAUNCH_QUEUE_POLICY) };
  if (
    Object.values(policy).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  )
    throw new Error("Invalid runtime launch queue policy.");
  let state: RuntimeLaunchQueueState = "notReady";
  let sink: RuntimeLaunchDispatchSink | null = null;
  let draining: Promise<void> | null = null;
  const pending: QueuedRuntimeLaunch[] = [];
  const owned = new Map<string, QueuedRuntimeLaunch>();
  const completed = new Map<string, { target: string; completedAt: number }>();

  function pruneCompleted(): void {
    const now = options.now();
    for (const [id, entry] of completed)
      if (now - entry.completedAt >= policy.completedHistoryTtlMs)
        completed.delete(id);
    while (completed.size > policy.maxCompletedHistory) {
      const first = completed.keys().next();
      if (!first.done) completed.delete(first.value);
    }
  }
  function suspendDrain(): void {
    if (state !== "stopping") state = "notReady";
  }
  function isReady(): boolean {
    return state === "ready";
  }
  function drain(): Promise<void> {
    if (draining) return draining;
    // Reserve the single drain before calling any user-provided async sink.
    draining = Promise.resolve()
      .then(async () => {
        while (state === "ready" && pending.length > 0 && sink) {
          const entry = pending[0];
          try {
            if (options.canDispatch && !options.canDispatch()) {
              suspendDrain();
              break;
            }
            if (!isReady()) break;
            const result = await sink(entry);
            if (result.kind !== "accepted") {
              suspendDrain();
              break;
            }
            // Even if stop/demotion happened while awaiting, removal is legal
            // only because downstream ownership has actually been accepted.
            pending.shift();
            owned.delete(entry.requestId);
            completed.set(entry.requestId, {
              target: entry.target,
              completedAt: options.now(),
            });
            pruneCompleted();
          } catch {
            suspendDrain();
            break;
          }
        }
      })
      .finally(() => {
        draining = null;
        // Enqueue may occur after the loop settles but before this cleanup.
        if (state === "ready" && pending.length > 0 && sink) return drain();
      });
    return draining;
  }
  function enqueue(
    request: ValidatedLaunchHandoff,
  ): RuntimeLaunchEnqueueResult {
    if (state === "stopping") return { kind: "notReadyForHandoff" };
    if (
      !isUuidv7(request.requestId) ||
      !request.target.trim() ||
      request.launch.origin !== "external"
    )
      return { kind: "rejected", reason: "handlerRejected" };
    pruneCompleted();
    const existing =
      owned.get(request.requestId) ?? completed.get(request.requestId);
    if (existing)
      return existing.target === request.target
        ? { kind: "accepted" }
        : { kind: "rejected", reason: "requestIdConflict" };
    if (pending.length >= policy.maxPendingLaunches)
      return { kind: "notReadyForHandoff" };
    const entry: QueuedRuntimeLaunch = Object.freeze({
      requestId: request.requestId,
      target: request.target,
      receivedAt: options.now(),
    });
    owned.set(entry.requestId, entry);
    pending.push(entry);
    // The receiver only acquires ownership. Actual routing runs separately.
    if (state === "ready") void drain();
    return { kind: "accepted" };
  }
  return {
    enqueue,
    receiver: async (request) => enqueue(request),
    current: () => ({ state, pending: pending.slice() }),
    markReady(nextSink) {
      if (typeof nextSink !== "function")
        throw new Error("A routing sink is required.");
      if (state === "stopping") return Promise.resolve();
      sink = nextSink;
      state = "ready";
      return drain();
    },
    stop() {
      state = "stopping";
    },
  };
}
