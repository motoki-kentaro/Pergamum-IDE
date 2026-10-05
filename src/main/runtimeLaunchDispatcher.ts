import path from "node:path";
import {
  classifyStartupMarkdownTarget,
  defaultStartupMarkdownRoutingDeps,
  type StartupMarkdownRoutingDeps,
} from "./startupMarkdownRouting";
import { isUrlLikeStartupInput } from "./startupProjectArgv";
import { isPathEqualOrInsideDirectory } from "../shared/saveTargetPolicy";
import type { AppPlatform } from "../shared/platform";
import {
  sameRuntimeProjectContext,
  type RuntimeLocalActionRequest,
  type RuntimeLocalActionResult,
  type RuntimeProjectContext,
} from "../shared/runtimeLaunchAction";
import type {
  QueuedRuntimeLaunch,
  RuntimeLaunchDispatchSink,
} from "./runtimeLaunchQueue";

export type RuntimeLaunchDispatchResult =
  | { readonly kind: "handled" }
  | { readonly kind: "rejected" }
  | { readonly kind: "requiresNewProcess"; readonly target: string }
  | { readonly kind: "retryLater" };
export function createRuntimeLaunchDispatcher(options: {
  readonly getContext: () => RuntimeProjectContext;
  readonly canDispatch: () => boolean;
  readonly dispatchLocal: (
    request: RuntimeLocalActionRequest,
  ) => Promise<RuntimeLocalActionResult>;
  readonly registerDocument: (absolutePath: string) => string | null;
  readonly releaseLocal?: (requestId: string) => void;
  readonly filesystem?: StartupMarkdownRoutingDeps;
  readonly platform: AppPlatform;
}) {
  const fs = options.filesystem ?? defaultStartupMarkdownRoutingDeps;
  // Once a local action is issued, a retry must repeat THAT action, including
  // its original context (promotion may have changed the current Project).
  const issued = new Map<string, RuntimeLocalActionRequest>();
  const equalPath = (a: string, b: string) =>
    isPathEqualOrInsideDirectory(a, b, options.platform) &&
    isPathEqualOrInsideDirectory(b, a, options.platform);
  async function dispatch(
    entry: QueuedRuntimeLaunch,
  ): Promise<RuntimeLaunchDispatchResult> {
    if (!options.canDispatch()) return { kind: "retryLater" };
    let request = issued.get(entry.requestId);
    if (request && request.target !== entry.target)
      return { kind: "retryLater" };
    if (!request) {
      const context = options.getContext();
      const unchanged = () =>
        options.canDispatch() &&
        sameRuntimeProjectContext(context, options.getContext());
      if (
        context.projectId === null
          ? context.rootPath !== null || context.projectFilePath !== null
          : !context.rootPath || !context.projectFilePath
      )
        return { kind: "retryLater" };
      if (
        !isUrlLikeStartupInput(entry.target) &&
        path.extname(entry.target).toLowerCase() === ".pergamum"
      )
        return { kind: "requiresNewProcess", target: entry.target };
      const classification = await classifyStartupMarkdownTarget(
        entry.target,
        fs,
      );
      if (!unchanged()) return { kind: "retryLater" };
      let action: RuntimeLocalActionRequest["action"];
      if (classification.kind === "rejected")
        action = { kind: "reject", reason: classification.reason };
      else if (context.projectId === null) {
        action =
          classification.kind === "externalFile"
            ? { kind: "standalone", filePath: classification.filePath }
            : {
                kind: "promoteProject",
                projectFilePath: classification.projectFilePath,
                filePath: classification.filePath,
              };
      } else {
        if (classification.kind === "externalFile")
          return { kind: "requiresNewProcess", target: entry.target };
        let locator: string, currentLocator: string, root: string;
        try {
          [locator, currentLocator, root] = await Promise.all([
            fs.realpath(classification.projectFilePath),
            fs.realpath(context.projectFilePath!),
            fs.realpath(context.rootPath!),
          ]);
        } catch {
          return { kind: "retryLater" };
        }
        if (!unchanged()) return { kind: "retryLater" };
        // Nearest locator is the identity; containment alone would mistake a
        // nested Project for the current Project.
        if (!equalPath(locator, currentLocator))
          return { kind: "requiresNewProcess", target: entry.target };
        if (
          !equalPath(classification.projectRootPath, root) ||
          !isPathEqualOrInsideDirectory(
            classification.filePath,
            root,
            options.platform,
          )
        ) {
          action = { kind: "reject", reason: "discoveryFailed" };
        } else {
          const relativePath = path.relative(root, classification.filePath);
          const localPath = path.join(context.rootPath!, relativePath);
          // Register only a proven same-project path through the existing
          // document registry, preserving normal read-only/read IPC semantics.
          if (!unchanged()) return { kind: "retryLater" };
          const registered = options.registerDocument(localPath);
          if (!registered) return { kind: "retryLater" };
          action = { kind: "projectDocument", relativePath: registered };
        }
      }
      if (!unchanged()) return { kind: "retryLater" };
      request = {
        requestId: entry.requestId,
        target: entry.target,
        expectedContext: context,
        action,
      };
      issued.set(entry.requestId, request);
    }
    try {
      const result = await options.dispatchLocal(request);
      if (result.kind === "handled" || result.kind === "rejected") {
        issued.delete(entry.requestId);
        // Main has verified the ACK. Until then the Renderer must retain its
        // result even after a timeout; ACK loss cannot cause repeated effects.
        try {
          options.releaseLocal?.(entry.requestId);
        } catch {
          /* Lost release only retains Renderer dedup history. */
        }
        return result;
      }
      return { kind: "retryLater" };
    } catch {
      return { kind: "retryLater" };
    }
  }
  const sink: RuntimeLaunchDispatchSink = async (entry) => {
    const result = await dispatch(entry);
    return result.kind === "handled" || result.kind === "rejected"
      ? { kind: "accepted" }
      : { kind: "temporaryFailure" };
  };
  return { dispatch, sink };
}
