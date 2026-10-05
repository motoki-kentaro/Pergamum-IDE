import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createUuidv7 } from "../../src/shared/uuidv7";
import { createRoutedChildRouter } from "../../src/main/routedChildRouter";
import {
  childClaimProof,
  childEnvironment,
  takeRoutedChildMetadata,
  notifyRoutedChildOwnership,
  type RoutedChildMetadata,
} from "../../src/main/routedChildClaim";
import { createRouterProbeEndpoint } from "../../src/main/primaryRouterEndpoint";
import { createRuntimeLaunchQueue } from "../../src/main/runtimeLaunchQueue";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import { startupRoutingIsSettled } from "../../src/renderer/runtimeRoutingSettlement";
const target = path.resolve("chapter 日本 & ().md");
function fixture() {
  const parent = createUuidv7();
  let metadata!: RoutedChildMetadata;
  const child = Object.assign(new EventEmitter(), { pid: 1234 });
  const spawn = vi.fn((_target: string, m: RoutedChildMetadata) => {
    metadata = m;
    return child;
  });
  const onClaimed = vi.fn();
  const router = createRoutedChildRouter({
    parentInstanceRunId: parent,
    endpoint: () => "unused",
    now: () => 0,
    spawn,
    onClaimed,
    policy: {
      claimTimeoutMs: 100,
      maxAttempts: 2,
      completedTtlMs: 60000,
      maxCompleted: 2,
    },
  });
  const entry = { requestId: createUuidv7(), target, receivedAt: 0 };
  const claim = () => {
    const unsigned = {
      protocolVersion: 1 as const,
      kind: "routedChildClaim" as const,
      requestId: entry.requestId,
      attemptId: metadata.attemptId,
      parentInstanceRunId: parent,
      childInstanceRunId: createUuidv7(),
      childPid: child.pid,
      target,
      nonce: metadata.nonce,
    };
    return { ...unsigned, proof: childClaimProof(metadata.secret, unsigned) };
  };
  return {
    router,
    entry,
    spawn,
    child,
    claim,
    onClaimed,
    metadata: () => metadata,
    parent,
  };
}
describe("routed child ownership", () => {
  it("shares concurrent spawn and transfers only after authenticated claim, even without response delivery", async () => {
    const h = fixture();
    const first = h.router.route(h.entry);
    expect(h.router.route(h.entry)).toBe(first);
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(
      h.router.receiveClaim({ ...h.claim(), proof: "0".repeat(64) }),
    ).toBeNull();
    expect(h.router.receiveClaim(h.claim())).not.toBeNull();
    expect(await first).toEqual({ kind: "claimed" });
    expect(await h.router.route(h.entry)).toEqual({ kind: "claimed" });
    expect(h.spawn).toHaveBeenCalledTimes(1);
    h.router.stop();
  });
  it.each(["timeout", "exit"])(
    "%s is uncertain, retains ownership and never spawns automatically again; late claim works",
    async (mode) => {
      vi.useFakeTimers();
      const h = fixture();
      const result = h.router.route(h.entry);
      if (mode === "exit") h.child.emit("exit");
      else await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ kind: "uncertain" });
      expect(await h.router.route(h.entry)).toEqual({ kind: "uncertain" });
      expect(h.spawn).toHaveBeenCalledTimes(1);
      expect(h.router.receiveClaim(h.claim())).not.toBeNull();
      expect(await h.router.route(h.entry)).toEqual({ kind: "claimed" });
      h.router.stop();
      vi.useRealTimers();
    },
  );
  it("rejects same id with different target and forged identity", async () => {
    const h = fixture();
    const result = h.router.route(h.entry);
    expect(
      await h.router.route({ ...h.entry, target: path.resolve("other.md") }),
    ).toEqual({ kind: "conflict" });
    const claim = h.claim();
    expect(h.router.receiveClaim({ ...claim, childPid: 9999 })).toBeNull();
    expect(h.router.receiveClaim({ ...claim, extra: true })).toBeNull();
    h.router.stop();
    expect(await result).toEqual({ kind: "uncertain" });
  });
  it("spawn throw does not transfer ownership", async () => {
    const router = createRoutedChildRouter({
      parentInstanceRunId: createUuidv7(),
      endpoint: () => "unused",
      now: () => 0,
      spawn: () => {
        throw new Error("missing executable");
      },
      onClaimed: () => {},
    });
    expect(
      await router.route({ requestId: createUuidv7(), target, receivedAt: 0 }),
    ).toEqual({ kind: "failedBeforeClaim" });
    router.stop();
  });
  it("strips private metadata both directions, preserves Forge env, and binds property-order-independent proof", () => {
    const h = fixture();
    const result = h.router.route(h.entry);
    const env = childEnvironment(
      {
        PERGAMUM_ROUTED_CHILD_OLD: "stale",
        ELECTRON_RUN_AS_NODE: "1",
        VITE_DEV_SERVER_URL: "keep",
      },
      h.metadata(),
    );
    expect(env.PERGAMUM_ROUTED_CHILD_OLD).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(takeRoutedChildMetadata(env)).toEqual(h.metadata());
    expect(env).toEqual({ VITE_DEV_SERVER_URL: "keep" });
    const claim = h.claim();
    expect(
      childClaimProof(
        h.metadata().secret,
        Object.fromEntries(Object.entries(claim).reverse()) as typeof claim,
      ),
    ).toBe(claim.proof);
    h.router.stop();
    void result;
  });
  it("malformed metadata is cleared before rejection", () => {
    const env = { PERGAMUM_ROUTED_CHILD_METADATA: "invalid", KEEP: "ok" };
    expect(() => takeRoutedChildMetadata(env)).toThrow();
    expect(env).toEqual({ KEEP: "ok" });
  });
  it("routed child bypasses external handoff parser without changing coordination participation", () => {
    expect(
      parseRuntimeLaunch(["Pergamum", "--pergamum-routed-launch=v1", target], {
        isPackaged: true,
      }),
    ).toMatchObject({ origin: "routedChild" });
  });
  it("accepted queue drains after demotion and consumes only a real endpoint claim; probe still works", async () => {
    const h = fixture();
    const self = {
      schemaVersion: 1 as const,
      scope: "a".repeat(64),
      instanceRunId: h.parent,
      pid: process.pid,
      startedAt: 1,
      probeSecret: "b".repeat(64),
    };
    const address =
      process.platform === "win32"
        ? "\\\\.\\pipe\\pg-claim-test-" + createUuidv7()
        : "/tmp/pg-claim-" + createUuidv7() + ".sock";
    const endpoint = createRouterProbeEndpoint(self, () => address, undefined, {
      current: () => ({ kind: "secondary", primary: self }),
      childClaim: h.router.receiveClaim,
    });
    const queue = createRuntimeLaunchQueue({ now: () => 0 });
    const launch = parseRuntimeLaunch(["app", target], { isPackaged: true });
    if (launch.kind !== "launch") throw new Error("fixture");
    queue.enqueue({ ...h.entry, launch });
    await endpoint.listen();
    try {
      expect(await endpoint.probe(self)).toBe(true);
      const drain = queue.markReady(async (entry) =>
        (await h.router.route(entry)).kind === "claimed"
          ? { kind: "accepted" }
          : { kind: "temporaryFailure" },
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(queue.current().pending).toHaveLength(1);
      expect(
        await notifyRoutedChildOwnership(
          { ...h.metadata(), endpoint: address },
          { instanceRunId: createUuidv7(), pid: h.child.pid },
          target,
        ),
      ).toBe(true);
      await drain;
      expect(queue.current().pending).toHaveLength(0);
    } finally {
      queue.stop();
      h.router.stop();
      await endpoint.close();
    }
  });
  it("startup settlement waits for Recovery evaluation, deferred errors and dialogs", () => {
    const state = {
      restoreSettled: true,
      markdownSettled: true,
      recoveryStatus: "owner" as const,
      recoveryEvaluationSettled: true,
      deferredErrorsOutstanding: false,
      modalOpen: false,
      lifecycleBarrier: false,
    };
    expect(startupRoutingIsSettled(state)).toBe(true);
    for (const change of [
      { restoreSettled: false },
      { markdownSettled: false },
      { recoveryStatus: "unknown" as const },
      { recoveryEvaluationSettled: false },
      { deferredErrorsOutstanding: true },
      { modalOpen: true },
      { lifecycleBarrier: true },
    ])
      expect(startupRoutingIsSettled({ ...state, ...change })).toBe(false);
  });
});
