import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { createUuidv7, isUuidv7 } from "../shared/uuidv7";
import {
  parseRuntimeLaunch,
  type RuntimeLaunch,
  type RuntimeLaunchParseResult,
} from "./runtimeLaunchRouting";
import type {
  PrimaryRouterStatus,
  RouterDiscoveryRecord,
  RouterProcessDescriptor,
} from "./primaryRouterCoordination";

export interface LaunchHandoffPolicy {
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly maxTargetLength: number;
  readonly acceptedTtlMs: number;
  readonly maxRequests: number;
}
export const DEFAULT_LAUNCH_HANDOFF_POLICY: LaunchHandoffPolicy = {
  timeoutMs: 2000,
  maxAttempts: 3,
  retryDelayMs: 1000,
  maxTargetLength: 2048,
  acceptedTtlMs: 60000,
  maxRequests: 256,
};
export function validateLaunchHandoffPolicy(policy: LaunchHandoffPolicy): void {
  if (
    Object.values(policy).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  )
    throw new Error("Invalid launch handoff policy.");
}
export type LaunchHandoffDisposition =
  | { readonly kind: "accepted" }
  | { readonly kind: "notPrimary" }
  | { readonly kind: "notReadyForHandoff" }
  | { readonly kind: "temporaryFailure" }
  | {
      readonly kind: "rejected";
      readonly reason:
        "invalidTarget" | "requestIdConflict" | "handlerRejected";
    }
  | { readonly kind: "protocolError" };
export type LaunchHandoffTransportResult =
  LaunchHandoffDisposition | { readonly kind: "transportFailure" };
export interface LaunchHandoffRequest {
  readonly protocolVersion: 1;
  readonly kind: "launchHandoff";
  readonly requestId: string;
  readonly target: string;
  readonly nonce: string;
  readonly proof: string;
}
export interface ValidatedLaunchHandoff {
  readonly requestId: string;
  readonly target: string;
  readonly launch: RuntimeLaunch;
}
/** accepted transfers ownership to the sink; a socket write never does.
 * A rejecting/throwing sink must not retain ownership or perform side effects.
 */
export type LaunchHandoffReceiver = (
  request: ValidatedLaunchHandoff,
) => Promise<
  | { readonly kind: "accepted" }
  | { readonly kind: "notReadyForHandoff" }
  | { readonly kind: "temporaryFailure" }
  | {
      readonly kind: "rejected";
      readonly reason: "handlerRejected" | "requestIdConflict";
    }
>;
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function parseLaunchHandoffRequest(
  value: Record<string, unknown>,
): LaunchHandoffRequest | null {
  if (
    !exact(value, [
      "protocolVersion",
      "kind",
      "requestId",
      "target",
      "nonce",
      "proof",
    ]) ||
    value.protocolVersion !== 1 ||
    value.kind !== "launchHandoff" ||
    !isUuidv7(value.requestId) ||
    typeof value.target !== "string" ||
    typeof value.nonce !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.nonce) ||
    typeof value.proof !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.proof)
  )
    return null;
  return value as unknown as LaunchHandoffRequest;
}
/** Fixed arrays, never JSON object property order. Both directions bind version,
 * message kind, id, target, nonce and full expected endpoint identity. Responses
 * also bind the disposition. The record secret does not authenticate a benign
 * Pergamum binary against malicious processes running as the same user.
 */
export function launchHandoffProof(
  record: RouterDiscoveryRecord,
  request: Pick<LaunchHandoffRequest, "requestId" | "target" | "nonce">,
  disposition?: LaunchHandoffDisposition,
): string {
  return createHmac("sha256", record.probeSecret)
    .update(
      JSON.stringify([
        disposition ? "response" : "request",
        1,
        disposition ? "launchHandoffResult" : "launchHandoff",
        request.requestId,
        request.target,
        request.nonce,
        record.schemaVersion,
        record.scope,
        record.instanceRunId,
        record.pid,
        record.startedAt,
        disposition?.kind ?? null,
        disposition?.kind === "rejected" ? disposition.reason : null,
      ]),
    )
    .digest("hex");
}
export function matchesHandoffProof(
  actual: unknown,
  expected: string,
): boolean {
  return (
    typeof actual === "string" &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}
export function parseLaunchHandoffResponse(
  value: Record<string, unknown>,
): LaunchHandoffDisposition | null {
  if (
    !exact(value, [
      "protocolVersion",
      "kind",
      "requestId",
      "nonce",
      "instanceRunId",
      "disposition",
      "proof",
    ]) ||
    value.protocolVersion !== 1 ||
    value.kind !== "launchHandoffResult"
  )
    return null;
  const d = value.disposition;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return null;
  const result = d as Record<string, unknown>;
  if (
    result.kind === "rejected" &&
    exact(result, ["kind", "reason"]) &&
    ["invalidTarget", "requestIdConflict", "handlerRejected"].includes(
      String(result.reason),
    )
  )
    return result as LaunchHandoffDisposition;
  if (
    exact(result, ["kind"]) &&
    [
      "accepted",
      "notPrimary",
      "notReadyForHandoff",
      "temporaryFailure",
      "protocolError",
    ].includes(String(result.kind))
  )
    return result as LaunchHandoffDisposition;
  return null;
}
export function revalidateHandoffTarget(
  target: string,
  policy: LaunchHandoffPolicy,
): RuntimeLaunch | null {
  if (target.length > policy.maxTargetLength || target.includes("\0"))
    return null;
  const parsed = parseRuntimeLaunch(["Pergamum", target], { isPackaged: true });
  return parsed.kind === "launch" && parsed.origin === "external"
    ? parsed
    : null;
}
export function createLaunchHandoffReceiver(
  current: () => PrimaryRouterStatus,
  handler: LaunchHandoffReceiver | undefined,
  now: () => number,
  policy: LaunchHandoffPolicy = DEFAULT_LAUNCH_HANDOFF_POLICY,
): (request: LaunchHandoffRequest) => Promise<LaunchHandoffDisposition> {
  validateLaunchHandoffPolicy(policy);
  const entries = new Map<
    string,
    {
      target: string;
      result: Promise<LaunchHandoffDisposition>;
      acceptedAt: number | null;
    }
  >();
  return async (request) => {
    const launch = revalidateHandoffTarget(request.target, policy);
    if (!launch) return { kind: "rejected", reason: "invalidTarget" };
    if (current().kind !== "primary") return { kind: "notPrimary" };
    for (const [id, entry] of entries)
      if (
        entry.acceptedAt !== null &&
        now() - entry.acceptedAt >= policy.acceptedTtlMs
      )
        entries.delete(id);
    const existing = entries.get(request.requestId);
    if (existing)
      return existing.target === request.target
        ? existing.result
        : { kind: "rejected", reason: "requestIdConflict" };
    if (!handler || entries.size >= policy.maxRequests)
      return { kind: "notReadyForHandoff" };
    const entry = {
      target: request.target,
      acceptedAt: null as number | null,
      result: null as unknown as Promise<LaunchHandoffDisposition>,
    };
    // Install the in-flight entry before invoking the sink. No await occurs
    // between the final Primary check and the synchronous handler invocation.
    entry.result = Promise.resolve()
      .then(async (): Promise<LaunchHandoffDisposition> => {
        if (current().kind !== "primary") return { kind: "notPrimary" };
        try {
          return await handler({
            requestId: request.requestId,
            target: request.target,
            launch,
          });
        } catch {
          return { kind: "temporaryFailure" };
        }
      })
      .then((result) => {
        if (result.kind === "accepted") entry.acceptedAt = now();
        else entries.delete(request.requestId);
        return result;
      });
    entries.set(request.requestId, entry);
    return entry.result;
  };
}
export type LaunchHandoffResult =
  | {
      readonly kind: "delivered";
      readonly requestId: string;
      readonly primary: RouterProcessDescriptor;
    }
  | {
      readonly kind: "notSent";
      readonly reason: "routedChild" | "invalidTarget" | "alreadyPrimary";
    }
  | {
      readonly kind: "failed";
      readonly requestId: string;
      readonly reason:
        | "discovering"
        | "unavailable"
        | "stopping"
        | "noReachablePrimary"
        | LaunchHandoffTransportResult["kind"];
      readonly delivery: "unconfirmed";
    };
export interface LaunchHandoffSenderDeps {
  current(): PrimaryRouterStatus;
  refresh(): Promise<PrimaryRouterStatus>;
  send(
    primary: RouterProcessDescriptor,
    requestId: string,
    target: string,
  ): Promise<LaunchHandoffTransportResult>;
  wait(delayMs: number): Promise<void>;
  requestId?(): string;
  deadline?<T>(operation: Promise<T>, timeoutMs: number): Promise<T>;
}
function deadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Handoff deadline exceeded.")),
      timeoutMs,
    );
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
/** Accepted-cache deduplication is bounded to this Primary's lifetime/TTL.
 * Lost ACKs and process replacement leave delivery uncertain, not exactly-once.
 */
export async function sendLaunchHandoff(
  launch: RuntimeLaunchParseResult,
  deps: LaunchHandoffSenderDeps,
  policy: LaunchHandoffPolicy = DEFAULT_LAUNCH_HANDOFF_POLICY,
): Promise<LaunchHandoffResult> {
  validateLaunchHandoffPolicy(policy);
  if (launch.kind !== "launch")
    return { kind: "notSent", reason: "invalidTarget" };
  if (launch.origin === "routedChild")
    return { kind: "notSent", reason: "routedChild" };
  // Sender cwd must not be reinterpreted using the Primary's cwd.
  const raw =
    launch.target.kind === "pergamum"
      ? launch.target.filePath
      : launch.target.rawInput;
  if (!revalidateHandoffTarget(raw, policy))
    return { kind: "notSent", reason: "invalidTarget" };
  const target = path.resolve(raw);
  if (!revalidateHandoffTarget(target, policy))
    return { kind: "notSent", reason: "invalidTarget" };
  const requestId = (deps.requestId ?? createUuidv7)();
  if (!isUuidv7(requestId)) return { kind: "notSent", reason: "invalidTarget" };
  const bounded = deps.deadline ?? deadline;
  let reason: Extract<LaunchHandoffResult, { kind: "failed" }>["reason"] =
    "noReachablePrimary";
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    const status = deps.current();
    if (status.kind === "primary") {
      if (attempt === 0) return { kind: "notSent", reason: "alreadyPrimary" };
      // An earlier write may have transferred ownership before its ACK was lost.
      // Becoming Primary cannot turn that uncertainty into permission to open.
      reason = "noReachablePrimary";
      break;
    }
    if (status.kind === "secondary") {
      const result = await bounded(
        deps.send(status.primary, requestId, target),
        policy.timeoutMs,
      ).catch(() => ({ kind: "transportFailure" }) as const);
      if (result.kind === "accepted")
        return { kind: "delivered", requestId, primary: status.primary };
      reason = result.kind;
      if (result.kind === "rejected" || result.kind === "protocolError") break;
    } else reason = status.kind;
    if (status.kind === "stopping") break;
    if (attempt + 1 < policy.maxAttempts) {
      await bounded(
        deps.wait(policy.retryDelayMs),
        policy.retryDelayMs + policy.timeoutMs,
      ).catch(() => undefined);
      await bounded(deps.refresh(), policy.timeoutMs).catch(() => undefined);
    }
  }
  return { kind: "failed", requestId, reason, delivery: "unconfirmed" };
}
