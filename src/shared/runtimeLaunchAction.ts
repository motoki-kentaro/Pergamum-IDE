import type { StartupMarkdownRejectionReason } from "./sessionRestore";
import { isUuidv7 } from "./uuidv7";

export const RUNTIME_LAUNCH_CHANNELS = {
  action: "runtimeLaunch:action",
  result: "runtimeLaunch:result",
  release: "runtimeLaunch:release",
  startupSettled: "runtimeLaunch:startupSettled",
  resume: "runtimeLaunch:resume",
} as const;
export interface RuntimeProjectContext {
  readonly projectId: string | null;
  readonly rootPath: string | null;
  readonly projectFilePath: string | null;
}
export type RuntimeLocalAction =
  | { readonly kind: "standalone"; readonly filePath: string }
  | { readonly kind: "projectDocument"; readonly relativePath: string }
  | {
      readonly kind: "promoteProject";
      readonly projectFilePath: string;
      readonly filePath: string;
    }
  | {
      readonly kind: "reject";
      readonly reason: StartupMarkdownRejectionReason;
    };
export interface RuntimeLocalActionRequest {
  readonly requestId: string;
  readonly target: string;
  readonly expectedContext: RuntimeProjectContext;
  readonly action: RuntimeLocalAction;
}
export type RuntimeLocalActionResult =
  | { readonly kind: "handled" }
  | { readonly kind: "rejected" }
  | { readonly kind: "retryLater" }
  | { readonly kind: "conflict" };
export interface RuntimeLocalActionResponse {
  readonly requestId: string;
  readonly result: RuntimeLocalActionResult;
}
export function sameRuntimeProjectContext(
  a: RuntimeProjectContext,
  b: RuntimeProjectContext,
): boolean {
  return (
    a.projectId === b.projectId &&
    a.rootPath === b.rootPath &&
    a.projectFilePath === b.projectFilePath
  );
}
/** Fixed fields, independent of JSON object property order. */
export function runtimeActionFingerprint(
  request: RuntimeLocalActionRequest,
): string {
  const a = request.action;
  return JSON.stringify([
    request.target,
    request.expectedContext.projectId,
    request.expectedContext.rootPath,
    request.expectedContext.projectFilePath,
    a.kind,
    "filePath" in a ? a.filePath : null,
    "relativePath" in a ? a.relativePath : null,
    "projectFilePath" in a ? a.projectFilePath : null,
    "reason" in a ? a.reason : null,
  ]);
}
const reasons: readonly string[] = [
  "ambiguousProject",
  "discoveryFailed",
  "isDirectory",
  "notAFile",
  "notFound",
  "unsupportedExtension",
  "urlLikeInput",
];
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 4096 &&
    !value.includes(String.fromCharCode(0))
  );
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return (
    Object.keys(value).length === allowed.length &&
    allowed.every((key) => Object.hasOwn(value, key))
  );
}
export function isRuntimeLocalActionRequest(
  value: unknown,
): value is RuntimeLocalActionRequest {
  if (
    !record(value) ||
    !isUuidv7(value.requestId) ||
    !text(value.target) ||
    !record(value.expectedContext) ||
    !record(value.action)
  )
    return false;
  if (!keys(value, ["requestId", "target", "expectedContext", "action"]))
    return false;
  const c = value.expectedContext;
  if (!keys(c, ["projectId", "rootPath", "projectFilePath"])) return false;
  if (
    ![c.projectId, c.rootPath, c.projectFilePath].every(
      (v) => v === null || text(v),
    )
  )
    return false;
  if (
    c.projectId === null
      ? c.rootPath !== null || c.projectFilePath !== null
      : c.rootPath === null || c.projectFilePath === null
  )
    return false;
  const a = value.action;
  switch (a.kind) {
    case "standalone":
      return (
        keys(a, ["kind", "filePath"]) &&
        c.projectId === null &&
        text(a.filePath)
      );
    case "projectDocument":
      return (
        keys(a, ["kind", "relativePath"]) &&
        c.projectId !== null &&
        text(a.relativePath) &&
        !a.relativePath.split(/[\\/]/).some((s) => s === "..") &&
        !/^(?:[\\/]|[a-z]:)/i.test(a.relativePath)
      );
    case "promoteProject":
      return (
        keys(a, ["kind", "projectFilePath", "filePath"]) &&
        c.projectId === null &&
        text(a.projectFilePath) &&
        text(a.filePath)
      );
    case "reject":
      return (
        keys(a, ["kind", "reason"]) &&
        typeof a.reason === "string" &&
        reasons.includes(a.reason)
      );
    default:
      return false;
  }
}
export function isRuntimeLocalActionResponse(
  value: unknown,
): value is RuntimeLocalActionResponse {
  return (
    record(value) &&
    isUuidv7(value.requestId) &&
    record(value.result) &&
    keys(value, ["requestId", "result"]) &&
    keys(value.result, ["kind"]) &&
    ["handled", "rejected", "retryLater", "conflict"].includes(
      String(value.result.kind),
    )
  );
}
