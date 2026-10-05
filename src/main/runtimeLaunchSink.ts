import type { RuntimeLaunchDispatchResult } from "./runtimeLaunchDispatcher";
import type { ChildRouteResult } from "./routedChildRouter";
import type {
  QueuedRuntimeLaunch,
  RuntimeLaunchDispatchSink,
} from "./runtimeLaunchQueue";

/** A routing intent is not a transfer. Only the local acknowledged owner or
 * a recorded child claim can release queue ownership.
 */
export function createRuntimeLaunchSink(options: {
  dispatch: (
    entry: QueuedRuntimeLaunch,
  ) => Promise<RuntimeLaunchDispatchResult>;
  routeChild: (entry: QueuedRuntimeLaunch) => Promise<ChildRouteResult>;
  releaseChild: (requestId: string) => void;
}): RuntimeLaunchDispatchSink {
  return async (entry) => {
    const result = await options.dispatch(entry);
    if (result.kind === "handled" || result.kind === "rejected")
      return { kind: "accepted" };
    if (result.kind === "requiresNewProcess") {
      const child = await options.routeChild(entry);
      if (child.kind === "claimed") {
        options.releaseChild(entry.requestId);
        return { kind: "accepted" };
      }
    }
    return { kind: "temporaryFailure" };
  };
}
