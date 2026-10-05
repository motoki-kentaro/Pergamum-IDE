import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createRuntimeLaunchQueue,
  DEFAULT_RUNTIME_LAUNCH_QUEUE_POLICY as defaults,
  type RuntimeLaunchDispatchSink,
} from "../../src/main/runtimeLaunchQueue";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import type { ValidatedLaunchHandoff } from "../../src/main/launchHandoff";
function request(index: number, target = "a.md"): ValidatedLaunchHandoff {
  const launch = parseRuntimeLaunch(["Pergamum", target], { isPackaged: true });
  if (launch.kind !== "launch") throw new Error("Invalid fixture");
  return {
    requestId: "019a0000-0000-7000-8000-" + index.toString().padStart(12, "0"),
    target,
    launch,
  };
}
function harness(policy = defaults) {
  let now = 0;
  const queue = createRuntimeLaunchQueue({ now: () => now, policy });
  return {
    queue,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const accepted = async () => ({ kind: "accepted" as const });
describe("runtime launch queue ownership", () => {
  it("retains pre-ready FIFO ownership without dispatch or transport metadata", async () => {
    const { queue } = harness();
    expect(await queue.receiver(request(1))).toEqual({ kind: "accepted" });
    queue.enqueue(request(2, "B.pergamum"));
    expect(queue.current()).toEqual({
      state: "notReady",
      pending: [
        { requestId: request(1).requestId, target: "a.md", receivedAt: 0 },
        {
          requestId: request(2).requestId,
          target: "B.pergamum",
          receivedAt: 0,
        },
      ],
    });
  });
  it("dispatches sequentially FIFO including enqueue during drain", async () => {
    const { queue } = harness();
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    queue.enqueue(request(1));
    queue.enqueue(request(2));
    const sink: RuntimeLaunchDispatchSink = async (entry) => {
      order.push(entry.requestId);
      if (entry.requestId === request(1).requestId) await blocked;
      return { kind: "accepted" };
    };
    const draining = queue.markReady(sink);
    await Promise.resolve();
    expect(queue.current().pending).toHaveLength(2);
    queue.enqueue(request(3));
    const second = queue.markReady(sink);
    expect(second).toBe(draining);
    release();
    await draining;
    expect(order).toEqual([
      request(1).requestId,
      request(2).requestId,
      request(3).requestId,
    ]);
    expect(queue.current().pending).toEqual([]);
  });
  it("keeps pending dedup regardless of time and distinguishes target conflicts", () => {
    const { queue, advance } = harness({ ...defaults, maxPendingLaunches: 1 });
    queue.enqueue(request(1));
    advance(defaults.completedHistoryTtlMs * 10);
    expect(queue.enqueue(request(1))).toEqual({ kind: "accepted" });
    expect(queue.enqueue(request(1, "other.md"))).toEqual({
      kind: "rejected",
      reason: "requestIdConflict",
    });
    expect(queue.enqueue(request(2))).toEqual({ kind: "notReadyForHandoff" });
    expect(queue.current().pending).toHaveLength(1);
  });
  it("keeps same target with different requestId as distinct actions", () => {
    const { queue } = harness();
    queue.enqueue(request(1));
    queue.enqueue(request(2));
    expect(queue.current().pending.map((entry) => entry.target)).toEqual([
      "a.md",
      "a.md",
    ]);
  });
  it("returns no accepted ownership on capacity failure, preserves existing entries", async () => {
    const { queue } = harness({ ...defaults, maxPendingLaunches: 1 });
    await queue.receiver(request(1));
    const before = queue.current();
    expect(await queue.receiver(request(2))).toEqual({
      kind: "notReadyForHandoff",
    });
    expect(queue.current()).toEqual(before);
  });
  it.each(["temporaryFailure", "rejected", "throws"] as const)(
    "retains head after %s and requires explicit retry",
    async (kind) => {
      const { queue } = harness();
      const sink = vi.fn(async () => {
        if (kind === "throws") throw new Error("Failure");
        return { kind };
      });
      queue.enqueue(request(1));
      queue.enqueue(request(2));
      await queue.markReady(sink);
      expect(queue.current().state).toBe("notReady");
      expect(queue.current().pending).toHaveLength(2);
      queue.enqueue(request(3));
      await Promise.resolve();
      expect(sink).toHaveBeenCalledTimes(1);
      await queue.markReady(accepted);
      expect(queue.current().pending).toEqual([]);
    },
  );
  it("never evicts owned requests when completed history expires or fills", async () => {
    const { queue, advance } = harness({ ...defaults, maxCompletedHistory: 1 });
    queue.enqueue(request(1));
    await queue.markReady(accepted);
    queue.enqueue(request(2));
    await queue.markReady(accepted);
    const fail = async () => ({ kind: "temporaryFailure" as const });
    queue.enqueue(request(3));
    await queue.markReady(fail);
    advance(defaults.completedHistoryTtlMs + 1);
    expect(queue.enqueue(request(3))).toEqual({ kind: "accepted" });
    expect(queue.current().pending.map((entry) => entry.requestId)).toEqual([
      request(3).requestId,
    ]);
  });
  it("dedups completed recent history and reports conflicts until TTL expiration", async () => {
    const { queue, advance } = harness();
    const sink = vi.fn(accepted);
    queue.enqueue(request(1));
    await queue.markReady(sink);
    expect(queue.enqueue(request(1))).toEqual({ kind: "accepted" });
    expect(queue.enqueue(request(1, "other.md"))).toEqual({
      kind: "rejected",
      reason: "requestIdConflict",
    });
    expect(sink).toHaveBeenCalledTimes(1);
    advance(defaults.completedHistoryTtlMs);
    queue.enqueue(request(1));
    await queue.markReady(sink);
    expect(sink).toHaveBeenCalledTimes(2);
  });
  it("bounds completed history without permanently refusing new launches", async () => {
    const { queue } = harness({ ...defaults, maxCompletedHistory: 1 });
    const sink = vi.fn(accepted);
    for (let i = 1; i <= 10; i++) {
      expect(queue.enqueue(request(i))).toEqual({ kind: "accepted" });
      await queue.markReady(sink);
    }
    expect(queue.enqueue(request(10))).toEqual({ kind: "accepted" });
    expect(queue.current().pending).toHaveLength(0);
    queue.enqueue(request(1));
    await queue.markReady(sink);
    expect(sink).toHaveBeenCalledTimes(11);
  });
  it("rejects new ownership and forbids new dispatch after synchronous stop", async () => {
    const { queue } = harness();
    queue.enqueue(request(1));
    queue.stop();
    queue.stop();
    expect(queue.enqueue(request(2))).toEqual({ kind: "notReadyForHandoff" });
    const sink = vi.fn(accepted);
    await queue.markReady(sink);
    expect(sink).not.toHaveBeenCalled();
    expect(queue.current().state).toBe("stopping");
    expect(queue.current().pending).toHaveLength(1);
  });
  it.each(["accepted", "temporaryFailure"] as const)(
    "handles in-flight %s after stopping without starting next dispatch",
    async (kind) => {
      const { queue } = harness();
      let release!: () => void;
      const wait = new Promise<void>((r) => {
        release = r;
      });
      const sink = vi.fn(async () => {
        await wait;
        return { kind };
      });
      queue.enqueue(request(1));
      queue.enqueue(request(2));
      const draining = queue.markReady(sink);
      await Promise.resolve();
      queue.stop();
      expect(queue.current().pending).toHaveLength(2);
      release();
      await draining;
      expect(queue.current().state).toBe("stopping");
      expect(sink).toHaveBeenCalledTimes(1);
      expect(queue.current().pending).toHaveLength(kind === "accepted" ? 1 : 2);
    },
  );
  it("rechecks election before dispatch and retains ownership after demotion", async () => {
    let primary = true;
    const queue = createRuntimeLaunchQueue({
      now: () => 0,
      canDispatch: () => primary,
    });
    queue.enqueue(request(1));
    queue.enqueue(request(2));
    const sink = vi.fn(async () => {
      primary = false;
      return { kind: "accepted" as const };
    });
    await queue.markReady(sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(queue.current().state).toBe("notReady");
    expect(queue.current().pending[0].requestId).toBe(request(2).requestId);
  });
  it("requires a real sink", () => {
    const { queue } = harness();
    expect(() =>
      queue.markReady(undefined as unknown as RuntimeLaunchDispatchSink),
    ).toThrow();
    expect(queue.current().state).toBe("notReady");
  });
  it.each([0, -1, 1.5])("rejects invalid policy %s", (value) => {
    expect(() => harness({ ...defaults, maxPendingLaunches: value })).toThrow();
  });
});

describe("drain settlement race", () => {
  it("dispatches an enqueue between empty drain completion and drain-lock release", async () => {
    const { queue } = harness();
    const sink = vi.fn(accepted);
    const draining = queue.markReady(sink);
    await Promise.resolve();
    queue.enqueue(request(1));
    await draining;
    expect(sink).toHaveBeenCalledTimes(1);
    expect(queue.current().pending).toHaveLength(0);
  });
  it("does not start dispatch if authority callback commits stop", async () => {
    const queue = createRuntimeLaunchQueue({
      now: () => 0,
      canDispatch: () => {
        queue.stop();
        return true;
      },
    });
    queue.enqueue(request(1));
    const sink = vi.fn(accepted);
    await queue.markReady(sink);
    expect(sink).not.toHaveBeenCalled();
    expect(queue.current()).toMatchObject({
      state: "stopping",
      pending: [{ requestId: request(1).requestId }],
    });
  });
});

describe("main routing queue integration boundary", () => {
  const main = readFileSync("src/main/main.ts", "utf8");
  it("creates the queue before endpoint initialization and keeps production notReady", () => {
    expect(
      main.indexOf("const runtimeLaunchQueue = createRuntimeLaunchQueue"),
    ).toBeLessThan(
      main.indexOf("primaryRouterInitialization = createRuntimePrimaryRouter"),
    );
    expect(main).toContain("handoffReceiver: runtimeLaunchQueue.receiver");
    expect(main).not.toContain("runtimeLaunchQueue.markReady(");
  });
  it("stops only on committed will-quit without adding an async wait or stopping on a cancelled quit request", () => {
    const start = main.indexOf('app.on("will-quit", () => {');
    const end = main.indexOf("installPrimaryRouterShutdown", start);
    const handler = main.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(handler).toContain("runtimeLaunchQueue.stop()");
    expect(handler).not.toContain("await");
    expect(handler).not.toContain("preventDefault");
    expect(handler).not.toContain("app.quit()");
    expect(main.match(/runtimeLaunchQueue[.]stop[(][)]/g)).toHaveLength(1);
  });
});
