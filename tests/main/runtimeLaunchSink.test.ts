import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createRuntimeLaunchSink } from "../../src/main/runtimeLaunchSink";
import { createRuntimeLaunchQueue } from "../../src/main/runtimeLaunchQueue";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import { createUuidv7 } from "../../src/shared/uuidv7";
describe("complete runtime routing ownership sink", () => {
  it.each(["B.pergamum", "A.pergamum", "foreign/chapter.md", "standalone.md"])(
    "%s shares the child path without consuming requiresNewProcess",
    async (target) => {
      const entry = {
        requestId: createUuidv7(),
        target: path.resolve(target),
        receivedAt: 0,
      };
      const route = vi.fn(async () => ({ kind: "uncertain" as const }));
      const release = vi.fn();
      const sink = createRuntimeLaunchSink({
        dispatch: async () => ({
          kind: "requiresNewProcess",
          target: entry.target,
        }),
        routeChild: route,
        releaseChild: release,
      });
      expect(await sink(entry)).toEqual({ kind: "temporaryFailure" });
      expect(release).not.toHaveBeenCalled();
      expect(route).toHaveBeenCalledWith(entry);
    },
  );
  it("queue retains pre-claim, drains FIFO only after claims, and all ready arrivals use the queue", async () => {
    const queue = createRuntimeLaunchQueue({ now: () => 0 });
    const add = (target: string) => {
      const absolute = path.resolve(target);
      const launch = parseRuntimeLaunch(["app", absolute], {
        isPackaged: true,
      });
      if (launch.kind !== "launch") throw new Error("fixture");
      queue.enqueue({ requestId: createUuidv7(), target: absolute, launch });
    };
    add("A.pergamum");
    add("B.pergamum");
    const order: string[] = [];
    let claim!: () => void;
    const sink = createRuntimeLaunchSink({
      dispatch: async (entry) => ({
        kind: "requiresNewProcess",
        target: entry.target,
      }),
      routeChild: async (entry) => {
        order.push(entry.target);
        if (order.length === 1)
          await new Promise<void>((resolve) => {
            claim = resolve;
          });
        return { kind: "claimed" };
      },
      releaseChild: () => {},
    });
    const draining = queue.markReady(sink);
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.current().pending).toHaveLength(2);
    add("C.pergamum");
    claim();
    await draining;
    expect(order).toEqual(
      ["A.pergamum", "B.pergamum", "C.pergamum"].map((x) => path.resolve(x)),
    );
    expect(queue.current().pending).toHaveLength(0);
    queue.stop();
  });
  it.each(["handled", "rejected"] as const)(
    "local %s transfers; no child process",
    async (kind) => {
      const routeChild = vi.fn();
      const sink = createRuntimeLaunchSink({
        dispatch: async () => ({ kind }),
        routeChild,
        releaseChild: () => {},
      });
      expect(
        await sink({
          requestId: createUuidv7(),
          target: "a.md",
          receivedAt: 0,
        }),
      ).toEqual({ kind: "accepted" });
      expect(routeChild).not.toHaveBeenCalled();
    },
  );
});
