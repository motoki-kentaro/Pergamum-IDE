import { describe, it, expect, vi } from "vitest";
import {
  createLaunchHandoffReceiver,
  sendLaunchHandoff,
  DEFAULT_LAUNCH_HANDOFF_POLICY as defaults,
  launchHandoffProof,
  parseLaunchHandoffRequest,
  revalidateHandoffTarget,
  type LaunchHandoffRequest,
} from "../../src/main/launchHandoff";
import {
  parseRuntimeLaunch,
  ROUTED_LAUNCH_MARKER,
} from "../../src/main/runtimeLaunchRouting";
import type {
  PrimaryRouterStatus,
  RouterDiscoveryRecord,
} from "../../src/main/primaryRouterCoordination";
const id = "019a0000-0000-7000-8000-000000000001";
const record: RouterDiscoveryRecord = {
  schemaVersion: 1,
  scope: "test",
  instanceRunId: id,
  pid: 1,
  startedAt: 1,
  probeSecret: "a".repeat(64),
};
const request = (target = "/book/a.md"): LaunchHandoffRequest => ({
  protocolVersion: 1,
  kind: "launchHandoff",
  requestId: id,
  target,
  nonce: "b".repeat(64),
  proof: "c".repeat(64),
});
const primary = (): PrimaryRouterStatus => ({ kind: "primary", self: record });
const launch = parseRuntimeLaunch(["Pergamum", "a.md"], { isPackaged: true });
describe("handoff ownership", () => {
  it("joins in-flight requests, caches accepted and rejects conflicting targets", async () => {
    let resolve!: (r: { kind: "accepted" }) => void;
    const handler = vi.fn(
      () =>
        new Promise<{ kind: "accepted" }>((r) => {
          resolve = r;
        }),
    );
    const receive = createLaunchHandoffReceiver(primary, handler, () => 0);
    const a = receive(request()),
      b = receive(request());
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await receive(request("/other.md"))).toEqual({
      kind: "rejected",
      reason: "requestIdConflict",
    });
    resolve({ kind: "accepted" });
    expect(await a).toEqual({ kind: "accepted" });
    expect(await b).toEqual({ kind: "accepted" });
    expect(await receive(request())).toEqual({ kind: "accepted" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it.each(["notReadyForHandoff", "temporaryFailure"] as const)(
    "does not cache %s",
    async (kind) => {
      const handler = vi
        .fn()
        .mockResolvedValueOnce({ kind })
        .mockResolvedValue({ kind: "accepted" });
      const receive = createLaunchHandoffReceiver(primary, handler, () => 0);
      expect(await receive(request())).toEqual({ kind });
      expect(await receive(request())).toEqual({ kind: "accepted" });
      expect(handler).toHaveBeenCalledTimes(2);
    },
  );
  it("retries after thrown handler failure", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue({ kind: "accepted" });
    const receive = createLaunchHandoffReceiver(primary, handler, () => 0);
    expect(await receive(request())).toEqual({ kind: "temporaryFailure" });
    expect(await receive(request())).toEqual({ kind: "accepted" });
  });
  it("checks Primary immediately before handler and does not cache demotion", async () => {
    let status = primary();
    const handler = vi.fn(async () => ({ kind: "accepted" as const }));
    const receive = createLaunchHandoffReceiver(
      () => status,
      handler,
      () => 0,
    );
    const pending = receive(request());
    status = { kind: "stopping" };
    expect(await pending).toEqual({ kind: "notPrimary" });
    expect(handler).not.toHaveBeenCalled();
    status = primary();
    expect(await receive(request())).toEqual({ kind: "accepted" });
  });
  it("enforces capacity without evicting accepted ownership, expires TTL", async () => {
    let now = 0;
    const handler = vi.fn(async () => ({ kind: "accepted" as const }));
    const receive = createLaunchHandoffReceiver(primary, handler, () => now, {
      ...defaults,
      maxRequests: 1,
    });
    await receive(request());
    expect(
      await receive({
        ...request(),
        requestId: "019a0000-0000-7000-8000-000000000002",
      }),
    ).toEqual({ kind: "notReadyForHandoff" });
    now = defaults.acceptedTtlMs;
    await receive(request());
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("does not ACK without a sink", async () => {
    expect(
      await createLaunchHandoffReceiver(primary, undefined, () => 0)(request()),
    ).toEqual({ kind: "notReadyForHandoff" });
  });
});
describe("validation and authentication", () => {
  it.each([
    "https://example.com/a.md",
    "",
    " ",
    ROUTED_LAUNCH_MARKER,
    "--debug",
    "a".repeat(2049),
    "a" + String.fromCharCode(0),
  ])("rejects %j", (target) => {
    expect(revalidateHandoffTarget(target, defaults)).toBeNull();
  });
  it("keeps unsupported extensions as candidates and one space-containing path as one target", () => {
    expect(revalidateHandoffTarget("/book/a.txt", defaults)?.target.kind).toBe(
      "markdown",
    );
    expect(revalidateHandoffTarget("/book/a b.md", defaults)).not.toBeNull();
  });
  it.each([
    { protocolVersion: 2 },
    { requestId: "bad" },
    { target: ["a.md", "b.md"] },
    { kind: "unknown" },
    { extra: true },
    { nonce: "short" },
  ])("rejects malformed schema %j", (patch) => {
    expect(parseLaunchHandoffRequest({ ...request(), ...patch })).toBeNull();
  });
  it("canonicalizes fixed fields, binds payload, identity and disposition", () => {
    const r = request();
    const reversed = Object.fromEntries(
      Object.entries(r).reverse(),
    ) as unknown as LaunchHandoffRequest;
    expect(launchHandoffProof(record, r)).toBe(
      launchHandoffProof(record, reversed),
    );
    expect(launchHandoffProof(record, { ...r, target: "/other.md" })).not.toBe(
      launchHandoffProof(record, r),
    );
    expect(launchHandoffProof({ ...record, pid: 2 }, r)).not.toBe(
      launchHandoffProof(record, r),
    );
    expect(launchHandoffProof(record, r, { kind: "accepted" })).not.toBe(
      launchHandoffProof(record, r, { kind: "notPrimary" }),
    );
  });
});
describe("bounded sender", () => {
  const deps = () => ({
    current: vi.fn((): PrimaryRouterStatus => ({
      kind: "secondary",
      primary: record,
    })),
    refresh: vi.fn(async (): Promise<PrimaryRouterStatus> => ({
      kind: "secondary",
      primary: record,
    })),
    send: vi.fn(
      async (_primary: unknown, _requestId: string, _target: string) => ({
        kind: "accepted" as const,
      }),
    ),
    wait: vi.fn(async () => undefined),
    requestId: () => id,
  });
  it("requires accepted ACK, refreshes changed Primary and preserves requestId", async () => {
    const d = deps();
    d.send = vi
      .fn()
      .mockResolvedValueOnce({ kind: "notPrimary" })
      .mockResolvedValue({ kind: "accepted" });
    d.refresh.mockImplementation(async () => {
      d.current.mockReturnValue({
        kind: "secondary",
        primary: { ...record, pid: 2 },
      });
      return d.current();
    });
    expect((await sendLaunchHandoff(launch, d)).kind).toBe("delivered");
    expect(d.send).toHaveBeenNthCalledWith(1, record, id, expect.any(String));
    expect(d.send).toHaveBeenNthCalledWith(
      2,
      { ...record, pid: 2 },
      id,
      expect.any(String),
    );
    expect(d.refresh).toHaveBeenCalledTimes(1);
  });
  it("bounds unavailable endpoint attempts, returns unconfirmed failure", async () => {
    const d = deps();
    d.send = vi.fn().mockResolvedValue({ kind: "transportFailure" });
    expect(await sendLaunchHandoff(launch, d)).toMatchObject({
      kind: "failed",
      reason: "transportFailure",
      delivery: "unconfirmed",
    });
    expect(d.send).toHaveBeenCalledTimes(defaults.maxAttempts);
  });
  it.each(["discovering", "unavailable", "stopping"] as const)(
    "never sends in %s",
    async (kind) => {
      const d = deps();
      d.current.mockReturnValue(
        kind === "unavailable"
          ? { kind, reason: "coordinationFailure" }
          : { kind },
      );
      expect(await sendLaunchHandoff(launch, d)).toMatchObject({
        kind: "failed",
        reason: kind,
      });
      expect(d.send).not.toHaveBeenCalled();
    },
  );
  it("never sends routedChild", async () => {
    const d = deps();
    const routed = parseRuntimeLaunch(
      ["Pergamum", ROUTED_LAUNCH_MARKER, "a.md"],
      { isPackaged: true },
    );
    expect(await sendLaunchHandoff(routed, d)).toEqual({
      kind: "notSent",
      reason: "routedChild",
    });
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe("handoff deadline and takeover uncertainty", () => {
  it("bounds stalled transport and refresh with an injected deadline", async () => {
    const never = new Promise<never>(() => undefined);
    const deadlineCalls = vi.fn();
    async function deadline<T>(
      _operation: Promise<T>,
      _timeout: number,
    ): Promise<T> {
      deadlineCalls();
      throw new Error("timeout");
    }
    const send = vi.fn(() => never);
    const result = await sendLaunchHandoff(
      launch,
      {
        current: () => ({ kind: "secondary", primary: record }),
        refresh: () => never,
        send,
        wait: async () => undefined,
        deadline,
        requestId: () => id,
      },
      { ...defaults, maxAttempts: 2 },
    );
    expect(result).toMatchObject({ kind: "failed", delivery: "unconfirmed" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(deadlineCalls).toHaveBeenCalled();
  });
  it("does not convert lost ACK to local permission after takeover", async () => {
    let status: PrimaryRouterStatus = { kind: "secondary", primary: record };
    expect(
      await sendLaunchHandoff(launch, {
        current: () => status,
        refresh: async () => {
          status = primary();
          return status;
        },
        send: async () => ({ kind: "transportFailure" }),
        wait: async () => undefined,
        requestId: () => id,
      }),
    ).toMatchObject({ kind: "failed", delivery: "unconfirmed" });
  });
});
