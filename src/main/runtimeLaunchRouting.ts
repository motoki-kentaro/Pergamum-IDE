import {
  extractColdStartLaunchTarget,
  type RawColdStartLaunchTarget
} from "./startupLaunchTarget";
import {
  isUrlLikeStartupInput,
  startupPositionalArguments,
  type StartupProjectArgvOptions
} from "./startupProjectArgv";
import type { StartupMarkdownClassification } from "./startupMarkdownRouting";
import type { StartupMarkdownRejectionReason } from "../shared/sessionRestore";

export const ROUTED_LAUNCH_OPTION = "--pergamum-routed-launch";
export const ROUTED_LAUNCH_MARKER = `${ROUTED_LAUNCH_OPTION}=v1`;

export type RuntimeLaunchOrigin = "external" | "routedChild";
export type RuntimeLaunchTarget = RawColdStartLaunchTarget;
export type RuntimeLaunchParseRejection =
  | "noTarget"
  | "multipleTargets"
  | "missingMarkerPayload"
  | "malformedMarker"
  | "duplicateMarker"
  | "missingRoutedTarget"
  | "urlLikeInput";

export type RuntimeLaunch = {
  readonly kind: "launch";
  readonly origin: RuntimeLaunchOrigin;
  readonly target: RuntimeLaunchTarget;
};

export type RuntimeLaunchParseResult =
  | RuntimeLaunch
  | {
      readonly kind: "rejected";
      readonly reason: RuntimeLaunchParseRejection;
    };

/** Validate the reserved option before the shared argv filter can discard it.
 * The marker is a loop-prevention disposition, not proof of authentication.
 * Its version is inline; the target remains a normal positional argument.
 */
export function parseRuntimeLaunch(
  argv: readonly string[],
  options: StartupProjectArgvOptions
): RuntimeLaunchParseResult {
  const markers = argv.slice(1).filter(
    (argument) => argument.startsWith(ROUTED_LAUNCH_OPTION)
  );
  if (markers.length > 1) {
    return { kind: "rejected", reason: "duplicateMarker" };
  }
  const marker = markers[0];
  if (marker === ROUTED_LAUNCH_OPTION || marker === `${ROUTED_LAUNCH_OPTION}=`) {
    return { kind: "rejected", reason: "missingMarkerPayload" };
  }
  if (marker !== undefined && marker !== ROUTED_LAUNCH_MARKER) {
    return { kind: "rejected", reason: "malformedMarker" };
  }

  const positional = startupPositionalArguments(argv, options);
  if (positional.length === 0) {
    return { kind: "rejected", reason: marker ? "missingRoutedTarget" : "noTarget" };
  }
  if (positional.length > 1) {
    return { kind: "rejected", reason: "multipleTargets" };
  }
  if (isUrlLikeStartupInput(positional[0])) {
    return { kind: "rejected", reason: "urlLikeInput" };
  }
  const target = extractColdStartLaunchTarget(argv, options);
  if (target === null) {
    return { kind: "rejected", reason: "noTarget" };
  }
  return { kind: "launch", origin: marker ? "routedChild" : "external", target };
}

export type RuntimeRoutingContext = {
  readonly isPrimary: boolean;
  readonly project:
    | { readonly kind: "projectless" }
    | {
        readonly kind: "project";
        readonly markdownOwnership: "unknown" | "current" | "foreign" | "unsafe";
      };
};

export type RuntimeLaunchDecision =
  | {
      readonly kind: "handleLocally";
      readonly route: "coldStart" | "classifyMarkdown" | "projectDocument";
    }
  | { readonly kind: "handoffToPrimary" }
  | { readonly kind: "spawnProcess" }
  | { readonly kind: "evaluateLocally"; readonly requirement: "currentProjectOwnership" }
  | {
      readonly kind: "reject";
      readonly reason:
        | RuntimeLaunchParseRejection
        | StartupMarkdownRejectionReason
        | "unsafeOwnership";
    };

/** Ownership is supplied by a later filesystem-aware layer, never guessed here.
 * Any supplied classification must describe this launch's Markdown candidate;
 * the caller obtains it through classifyStartupMarkdownTarget, not new discovery.
 * Local handling is an intent to use the named safe lifecycle, not permission
 * to open a Markdown candidate as standalone writable content.
 */
export function decideRuntimeLaunchRouting(
  launch: RuntimeLaunchParseResult,
  context: RuntimeRoutingContext,
  markdownClassification?: StartupMarkdownClassification
): RuntimeLaunchDecision {
  if (launch.kind === "rejected") {
    return { kind: "reject", reason: launch.reason };
  }
  if (launch.target.kind === "markdown" && markdownClassification?.kind === "rejected") {
    return { kind: "reject", reason: markdownClassification.reason };
  }
  // Routed destinations consume their target once via cold start, even if
  // they later become Primary. Re-handoff or re-spawn would create a loop.
  if (launch.origin === "routedChild") {
    return { kind: "handleLocally", route: "coldStart" };
  }
  if (!context.isPrimary) {
    return { kind: "handoffToPrimary" };
  }
  if (launch.target.kind === "pergamum") {
    return { kind: "spawnProcess" };
  }
  if (context.project.kind === "projectless") {
    return { kind: "handleLocally", route: "classifyMarkdown" };
  }
  switch (context.project.markdownOwnership) {
    case "current":
      return { kind: "handleLocally", route: "projectDocument" };
    case "foreign":
      return { kind: "spawnProcess" };
    case "unknown":
      return { kind: "evaluateLocally", requirement: "currentProjectOwnership" };
    case "unsafe":
      return { kind: "reject", reason: "unsafeOwnership" };
  }
}
