import { describe, expect, it, vi } from "vitest";
import {
  createPrimaryRouterCoordinator,
  compareRouterProcesses,
  parseRouterDiscoveryRecord,
  DEFAULT_PRIMARY_ROUTER_POLICY,
  installPrimaryRouterShutdown,
  type RouterDiscoveryRecord,
  type PrimaryRouterPolicy,
} from "../../src/main/primaryRouterCoordination";

const policy: PrimaryRouterPolicy = {
  ...DEFAULT_PRIMARY_ROUTER_POLICY,
  scanIntervalMs: 10,
  stableObservationCount: 2,
  unreachableFailureThreshold: 2,
  statusFreshnessMs: 100,
};
const record = (index: number, startedAt = index): RouterDiscoveryRecord => ({
  schemaVersion: 1,
  scope: "test",
  pid: index + 10,
  startedAt,
  instanceRunId: `019a0000-0000-7000-8000-${index.toString().padStart(12, "0")}`,
  probeSecret: index.toString().padStart(64, "0"),
});

function harness(customPolicy = policy) {
  let now = 0;
  let listFailure = false;
  const records = new Map<string, RouterDiscoveryRecord>();
  const reachable = new Set<string>();
  const scheduled = new Map<number, () => void>();
  let nextSchedule = 0;
  const make = (self: RouterDiscoveryRecord) =>
    createPrimaryRouterCoordinator(
      self,
      {
        register: async () => {
          records.set(self.instanceRunId, self);
          reachable.add(self.instanceRunId);
        },
        list: async () => {
          if (listFailure) throw new Error("EACCES");
          return [...records.values()].reverse();
        },
        probe: async (candidate) => reachable.has(candidate.instanceRunId),
        unregister: async () => {
          records.delete(self.instanceRunId);
          reachable.delete(self.instanceRunId);
        },
        now: () => now,
        schedule(callback) {
          const id = nextSchedule++;
          scheduled.set(id, callback);
          return () => {
            scheduled.delete(id);
          };
        },
      },
      customPolicy,
    );
  return {
    make,
    records,
    reachable,
    scheduled,
    advance: (ms = customPolicy.scanIntervalMs) => {
      now += ms;
    },
    failList: (value: boolean) => {
      listFailure = value;
    },
  };
}

describe("Primary Router discovery domain", () => {
  it("orders by process start observation, not registration order or PID", () => {
    const a = record(1, 50),
      b = record(2, 10);
    expect(compareRouterProcesses(a, b)).toBeGreaterThan(0);
    expect(compareRouterProcesses({ ...a, pid: 1 }, b)).toBeGreaterThan(0);
    expect(compareRouterProcesses(record(1, 10), b)).toBeLessThan(0);
  });
  it("validates records without silently reinterpreting malformed identities", () => {
    expect(parseRouterDiscoveryRecord(record(1), "test")).toEqual(record(1));
    for (const invalid of [
      null,
      [],
      {},
      { ...record(1), schemaVersion: 2 },
      { ...record(1), scope: "foreign" },
      { ...record(1), pid: 0 },
      { ...record(1), startedAt: NaN },
      { ...record(1), instanceRunId: "pid:11" },
      { ...record(1), probeSecret: "short" },
    ]) {
      expect(parseRouterDiscoveryRecord(invalid, "test")).toBeNull();
    }
  });
  it("rejects invalid policies including one-observation promotion", () => {
    for (const invalid of [
      { ...policy, probeTimeoutMs: 0 },
      { ...policy, stableObservationCount: 1 },
      { ...policy, scanIntervalMs: -1 },
      { ...policy, statusFreshnessMs: 10 },
    ]) {
      expect(() => harness(invalid).make(record(1))).toThrow();
    }
  });
});

describe("Primary Router election", () => {
  it("starts discovering and cannot promote from repeated immediate self-only scans", async () => {
    const h = harness();
    const a = h.make(record(1));
    expect(a.current()).toEqual({ kind: "discovering" });
    await a.start();
    expect(a.current()).toEqual({ kind: "discovering" });
    await a.refresh();
    await a.refresh();
    expect(a.current()).toEqual({ kind: "discovering" });
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("primary");
    expect(JSON.stringify(a.current())).not.toContain("probeSecret");
    await a.stop();
  });
  it("stabilizes A/B/C and naturally takes over A -> B -> C on normal exits", async () => {
    const h = harness();
    const a = h.make(record(1)),
      b = h.make(record(2)),
      c = h.make(record(3));
    await a.start();
    await b.start();
    await c.start();
    h.advance();
    await Promise.all([a.refresh(), b.refresh(), c.refresh()]);
    expect(a.current().kind).toBe("primary");
    expect(b.current()).toMatchObject({
      kind: "secondary",
      primary: { instanceRunId: record(1).instanceRunId },
    });
    expect(c.current().kind).toBe("secondary");
    await a.stop();
    h.advance();
    await Promise.all([b.refresh(), c.refresh()]);
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await Promise.all([b.refresh(), c.refresh()]);
    expect(b.current().kind).toBe("primary");
    expect(c.current()).toMatchObject({
      kind: "secondary",
      primary: { instanceRunId: record(2).instanceRunId },
    });
    await b.stop();
    h.advance();
    await c.refresh();
    h.advance();
    await c.refresh();
    expect(c.current().kind).toBe("primary");
    await c.stop();
    expect(h.scheduled.size).toBe(0);
  });
  it("uses the failure threshold for crash/stale takeover without deleting another run", async () => {
    const h = harness();
    h.records.set(record(1).instanceRunId, record(1));
    const b = h.make(record(2));
    await b.start();
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("primary");
    expect(h.records.get(record(1).instanceRunId)).toEqual(record(1));
    await b.stop();
    expect(h.records.size).toBe(1);
  });
  it("waits for a reachable winner after a known Primary stops responding", async () => {
    const h = harness();
    const a = h.make(record(1)),
      b = h.make(record(2));
    await a.start();
    await b.start();
    h.advance();
    await b.refresh();
    h.reachable.delete(record(1).instanceRunId);
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("primary");
    h.reachable.add(record(1).instanceRunId);
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("secondary");
    await Promise.all([a.stop(), b.stop()]);
  });
  it("converges after simultaneous starts with reversed publication and timestamp ties", async () => {
    const h = harness();
    const a = h.make(record(1, 10)),
      b = h.make(record(2, 10)),
      c = h.make(record(3, 10));
    await Promise.all([c.start(), b.start(), a.start()]);
    expect([a, b, c].every((p) => p.current().kind === "discovering")).toBe(
      true,
    );
    for (let i = 0; i < policy.stableObservationCount; i++) {
      h.advance();
      await Promise.all([c.refresh(), a.refresh(), b.refresh()]);
    }
    expect(
      [a, b, c].filter((p) => p.current().kind === "primary"),
    ).toHaveLength(1);
    expect(a.current().kind).toBe("primary");
    await Promise.all([a.stop(), b.stop(), c.stop()]);
  });
  it("observes a late-published older run and resets the winning streak", async () => {
    const h = harness();
    const b = h.make(record(2));
    await b.start();
    const a = h.make(record(1));
    await a.start();
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("discovering");
    h.advance();
    await b.refresh();
    expect(b.current().kind).toBe("secondary");
    await Promise.all([a.stop(), b.stop()]);
  });
  it("expires cached Primary after suspension and restabilizes", async () => {
    const h = harness();
    const a = h.make(record(1));
    await a.start();
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("primary");
    h.advance(policy.statusFreshnessMs + 1);
    expect(a.current().kind).toBe("discovering");
    await a.refresh();
    expect(a.current().kind).toBe("discovering");
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("primary");
    await a.stop();
  });
  it("treats unreadable or missing self discovery as unavailable, never as an empty election", async () => {
    const h = harness();
    const a = h.make(record(1));
    await a.start();
    h.failList(true);
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("unavailable");
    h.failList(false);
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("discovering");
    h.records.clear();
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("unavailable");
    await a.stop();
  });
  it("honors injected stabilization count", async () => {
    const h = harness({ ...policy, stableObservationCount: 3 });
    const a = h.make(record(1));
    await a.start();
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("discovering");
    h.advance();
    await a.refresh();
    expect(a.current().kind).toBe("primary");
    await a.stop();
  });
  it("periodic scans continue after discovery failure and stop cancels the scheduler", async () => {
    const h = harness();
    const a = h.make(record(1));
    await a.start();
    h.failList(true);
    h.advance();
    const callback = [...h.scheduled.values()][0];
    h.scheduled.clear();
    callback();
    await a.refresh();
    expect(a.current().kind).toBe("unavailable");
    await a.stop();
    expect(h.scheduled.size).toBe(0);
    expect((await a.refresh()).kind).toBe("stopping");
  });
  it("does not resurrect after stop during registration", async () => {
    let finish!: () => void;
    const unregister = vi.fn(async () => undefined);
    const a = createPrimaryRouterCoordinator(
      record(1),
      {
        register: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        list: async () => [record(1)],
        probe: async () => true,
        unregister,
        now: () => 0,
        schedule: () => () => undefined,
      },
      policy,
    );
    const start = a.start();
    const stop = a.stop();
    finish();
    await Promise.all([start, stop]);
    expect(a.current().kind).toBe("stopping");
    expect(unregister).toHaveBeenCalledTimes(1);
  });
  it("coalesces in-flight probes and deactivates immediately on stop", async () => {
    let release!: (reachable: boolean) => void;
    let now = 0;
    let delayProbe = false;
    const probe = vi.fn(() =>
      delayProbe
        ? new Promise<boolean>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(true),
    );
    const markStopping = vi.fn();
    const a = createPrimaryRouterCoordinator(
      record(1),
      {
        register: async () => undefined,
        list: async () => [record(1)],
        probe,
        unregister: async () => undefined,
        markStopping,
        now: () => now,
        schedule: () => () => undefined,
      },
      policy,
    );
    await a.start();
    delayProbe = true;
    now += policy.scanIntervalMs;
    const first = a.refresh();
    const second = a.refresh();
    expect(first).toBe(second);
    await Promise.resolve();
    const stopped = a.stop();
    expect(markStopping).toHaveBeenCalledTimes(1);
    expect(a.current().kind).toBe("stopping");
    release(true);
    await Promise.all([first, second, stopped]);
    expect(a.current().kind).toBe("stopping");
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it("cleans partial registration failure without scheduling election", async () => {
    const unregister = vi.fn(async () => undefined);
    const schedule = vi.fn(() => () => undefined);
    const a = createPrimaryRouterCoordinator(
      record(1),
      {
        register: async () => {
          throw new Error("publish failed");
        },
        list: async () => [],
        probe: async () => false,
        unregister,
        now: () => 0,
        schedule,
      },
      policy,
    );
    await a.start();
    expect(a.current().kind).toBe("unavailable");
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
    await a.stop();
  });
});

describe("Primary Router quit boundary", () => {
  it("cleans up only on committed will-quit and resumes quit once", async () => {
    let listener!: (event: { preventDefault(): void }) => void;
    let finish!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const quit = vi.fn();
    const on = vi.fn((_event: "will-quit", callback: typeof listener) => {
      listener = callback;
    });
    installPrimaryRouterShutdown({ on, quit }, stop);
    expect(on.mock.calls[0][0]).toBe("will-quit");
    expect(stop).not.toHaveBeenCalled();
    const event = { preventDefault: vi.fn() };
    listener(event);
    listener(event);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    listener(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });
});
