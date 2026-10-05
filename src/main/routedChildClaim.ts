import { createHmac, timingSafeEqual } from "node:crypto";
import net from "node:net";
import { isUuidv7 } from "../shared/uuidv7";

export const ROUTED_CHILD_ENV = "PERGAMUM_ROUTED_CHILD_";
export interface RoutedChildMetadata {
  requestId: string;
  attemptId: string;
  parentInstanceRunId: string;
  endpoint: string;
  nonce: string;
  secret: string;
}
export interface RoutedChildClaim {
  protocolVersion: 1;
  kind: "routedChildClaim";
  requestId: string;
  attemptId: string;
  parentInstanceRunId: string;
  childInstanceRunId: string;
  childPid: number;
  target: string;
  nonce: string;
  proof: string;
}
const hex = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function clearRoutedChildEnvironment(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env))
    if (key.toUpperCase().startsWith(ROUTED_CHILD_ENV)) delete env[key];
}
export function childEnvironment(
  base: NodeJS.ProcessEnv,
  metadata: RoutedChildMetadata,
): NodeJS.ProcessEnv {
  const env = { ...base };
  clearRoutedChildEnvironment(env);
  for (const key of Object.keys(env))
    if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") delete env[key];
  env[ROUTED_CHILD_ENV + "METADATA"] = JSON.stringify(metadata);
  return env;
}
export function takeRoutedChildMetadata(
  env: NodeJS.ProcessEnv,
): RoutedChildMetadata | null {
  const keys = Object.keys(env).filter((key) =>
    key.toUpperCase().startsWith(ROUTED_CHILD_ENV),
  );
  const raw = env[ROUTED_CHILD_ENV + "METADATA"];
  clearRoutedChildEnvironment(env);
  if (!keys.length) return null;
  if (keys.length !== 1 || !raw || raw.length > 4096)
    throw new Error("Invalid routed child metadata.");
  let value: RoutedChildMetadata;
  try {
    value = JSON.parse(raw) as RoutedChildMetadata;
  } catch {
    throw new Error("Invalid routed child metadata.");
  }
  if (
    !value ||
    Object.keys(value).sort().join() !==
      "attemptId,endpoint,nonce,parentInstanceRunId,requestId,secret" ||
    !isUuidv7(value.requestId) ||
    !isUuidv7(value.attemptId) ||
    !isUuidv7(value.parentInstanceRunId) ||
    typeof value.endpoint !== "string" ||
    !value.endpoint ||
    value.endpoint.length > 512 ||
    value.endpoint.includes("\0") ||
    !hex(value.nonce) ||
    !hex(value.secret)
  )
    throw new Error("Invalid routed child metadata.");
  return value;
}
/** Fixed ordered fields, including direction and both process identities.
 * This is advisory same-user authentication, not protection against a malicious same-user process.
 */
export function childClaimProof(
  secret: string,
  claim: Omit<RoutedChildClaim, "proof">,
  response = false,
): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        response ? "response" : "request",
        1,
        "routedChildClaim",
        claim.requestId,
        claim.attemptId,
        claim.parentInstanceRunId,
        claim.childInstanceRunId,
        claim.childPid,
        claim.target,
        claim.nonce,
      ]),
    )
    .digest("hex");
}
export function validChildClaim(value: unknown): value is RoutedChildClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as RoutedChildClaim;
  return (
    Object.keys(v).sort().join() ===
      "attemptId,childInstanceRunId,childPid,kind,nonce,parentInstanceRunId,proof,protocolVersion,requestId,target" &&
    v.protocolVersion === 1 &&
    v.kind === "routedChildClaim" &&
    isUuidv7(v.requestId) &&
    isUuidv7(v.attemptId) &&
    isUuidv7(v.parentInstanceRunId) &&
    isUuidv7(v.childInstanceRunId) &&
    Number.isSafeInteger(v.childPid) &&
    v.childPid > 0 &&
    typeof v.target === "string" &&
    v.target.length > 0 &&
    v.target.length <= 2048 &&
    !v.target.includes("\0") &&
    hex(v.nonce) &&
    hex(v.proof)
  );
}
export function matchesChildProof(actual: string, expected: string): boolean {
  return (
    hex(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}
/** Child already owns the cold-start payload. Failure here never undoes that ownership. */
export function notifyRoutedChildOwnership(
  metadata: RoutedChildMetadata,
  identity: { instanceRunId: string; pid: number },
  target: string,
  policy = { timeoutMs: 2000, maxMessageBytes: 4096 },
): Promise<boolean> {
  const unsigned: Omit<RoutedChildClaim, "proof"> = {
    protocolVersion: 1,
    kind: "routedChildClaim",
    requestId: metadata.requestId,
    attemptId: metadata.attemptId,
    parentInstanceRunId: metadata.parentInstanceRunId,
    childInstanceRunId: identity.instanceRunId,
    childPid: identity.pid,
    target,
    nonce: metadata.nonce,
  };
  const frame =
    JSON.stringify({
      ...unsigned,
      proof: childClaimProof(metadata.secret, unsigned),
    }) + "\n";
  if (Buffer.byteLength(frame) > policy.maxMessageBytes)
    return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection(metadata.endpoint);
    let finished = false,
      pending = Buffer.alloc(0);
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), policy.timeoutMs);
    socket.once("connect", () => socket.write(frame));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > policy.maxMessageBytes) return finish(false);
      const end = pending.indexOf(10);
      if (end < 0) return;
      if (end !== pending.length - 1) return finish(false);
      try {
        const v = JSON.parse(pending.subarray(0, end).toString("utf8"));
        finish(
          Object.keys(v).sort().join() ===
            "attemptId,kind,parentInstanceRunId,proof,requestId" &&
            v.kind === "routedChildClaimResult" &&
            v.requestId === metadata.requestId &&
            v.attemptId === metadata.attemptId &&
            v.parentInstanceRunId === metadata.parentInstanceRunId &&
            matchesChildProof(
              v.proof,
              childClaimProof(metadata.secret, unsigned, true),
            ),
        );
      } catch {
        finish(false);
      }
    });
  });
}
