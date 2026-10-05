import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  routeExternalLaunchStartup,
  withColdStartOwnership,
} from "../../src/main/externalLaunchStartup";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import { createRuntimeLaunchQueue } from "../../src/main/runtimeLaunchQueue";
import { createUuidv7 } from "../../src/shared/uuidv7";
import type { PrimaryRouterStatus } from "../../src/main/primaryRouterCoordination";
const self = { instanceRunId: createUuidv7(), pid: 1, startedAt: 1 };
const policy = {
  maxObservations: 3,
  observationIntervalMs: 1,
  operationTimeoutMs: 100,
};
const launch = (target = "chapter.md", routed = false) =>
  parseRuntimeLaunch(
    ["app", ...(routed ? ["--pergamum-routed-launch=v1"] : []), target],
    { isPackaged: true },
  );
describe("external argv startup ownership gate", () => {
  it("waits for initialization and discovering stabilization; never enqueues against an unconfirmed Primary", async () => {
    let status: PrimaryRouterStatus = { kind: "discovering" };
    let initialized!: (router: any) => void;
    let observed!: () => void;
    const enqueue = vi.fn(() => ({ kind: "accepted" as const }));
    const refresh = vi.fn(async () => {
      status = { kind: "primary", self };
      return status;
    });
    const operation = routeExternalLaunchStartup({
      launch: launch(),
      router: () =>
        new Promise((resolve) => {
          initialized = resolve;
        }),
      enqueue,
      wait: () =>
        new Promise((resolve) => {
          observed = resolve;
        }),
      policy,
    });
    await Promise.resolve();
    expect(enqueue).not.toHaveBeenCalled();
    initialized({ current: () => status, refresh, handoff: vi.fn() });
    await vi.waitFor(() => expect(observed).toBeDefined());
    expect(enqueue).not.toHaveBeenCalled();
    observed();
    expect(await operation).toMatchObject({
      kind: "queuedColdStart",
      target: path.resolve("chapter.md"),
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it.each(["A.pergamum", "chapter.md", "chapter.markdown"])(
    "genuine cold start %s stays in its first process and transfers queue ownership only to the real cold-start path",
    async (target) => {
      const queue = createRuntimeLaunchQueue({ now: () => 0 });
      const result = await routeExternalLaunchStartup({
        launch: launch(target),
        router: async () => ({
          current: () => ({ kind: "primary", self }),
          refresh: async () => ({ kind: "primary", self }),
          handoff: vi.fn(),
        }),
        enqueue: queue.enqueue,
        policy,
      });
      if (result.kind !== "queuedColdStart") throw new Error("fixture");
      let owned = false;
      const runtime = vi.fn(async () => ({ kind: "accepted" as const }));
      const sink = withColdStartOwnership({
        initial: result,
        coldStartOwned: () => owned,
        downstream: runtime,
      });
      await queue.markReady(sink);
      expect(queue.current().pending).toHaveLength(1);
      owned = true;
      await queue.markReady(sink);
      expect(queue.current().pending).toHaveLength(0);
      expect(runtime).not.toHaveBeenCalled();
      queue.stop();
    },
  );
  it("routedChild bypasses election completely and uses existing cold start", async () => {
    const router = vi.fn();
    const enqueue = vi.fn();
    expect(
      await routeExternalLaunchStartup({
        launch: launch("A.pergamum", true),
        router,
        enqueue,
        policy,
      }),
    ).toEqual({ kind: "coldStart" });
    expect(router).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("no target retains ordinary Session startup", async () => {
    expect(
      await routeExternalLaunchStartup({
        launch: parseRuntimeLaunch(["app"], { isPackaged: true }),
        router: vi.fn(),
        enqueue: vi.fn(),
      }),
    ).toEqual({ kind: "coldStart" });
  });
  it.each([
    { argv: ["app", "https://example.com/chapter.md"] },
    { argv: ["app", "one.md", "two.md"] },
  ])(
    "malformed/URL-like argv is explicitly rejected, never reinterpreted as local cold start",
    async ({ argv }) => {
      const router = vi.fn(),
        enqueue = vi.fn();
      expect(
        await routeExternalLaunchStartup({
          launch: parseRuntimeLaunch(argv, { isPackaged: true }),
          router,
          enqueue,
        }),
      ).toEqual({ kind: "rejected", reason: argv.length === 2 ? "urlLikeInput" : "multipleTargets" });
      expect(router).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
  it("accepted handoff exits without local queue ownership or cold-start permission", async () => {
    const enqueue = vi.fn();
    const handoff = vi.fn(async () => ({
      kind: "delivered" as const,
      requestId: createUuidv7(),
      primary: self,
    }));
    expect(
      await routeExternalLaunchStartup({
        launch: launch(),
        router: async () => ({
          current: () => ({ kind: "secondary", primary: self }),
          refresh: async () => ({ kind: "secondary", primary: self }),
          handoff,
        }),
        enqueue,
        policy,
      }),
    ).toEqual({ kind: "handedOff" });
    expect(enqueue).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledOnce();
  });
  it("definite invalidTarget before handoff is terminal rejection", async () => {
    const enqueue = vi.fn();
    const handoff = vi.fn(async () => ({ kind: "notSent" as const, reason: "invalidTarget" as const }));
    const refresh = vi.fn();
    expect(await routeExternalLaunchStartup({
      launch: launch(),
      router: async () => ({
        current: () => ({ kind: "secondary", primary: self }),
        refresh,
        handoff,
      }),
      enqueue,
    })).toEqual({ kind: "rejected", reason: "invalidTarget" });
    expect(handoff).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("production terminal rejection shows existing wording and exits before routing uncertainty or any local startup", () => {
    const main = readFileSync("src/main/main.ts", "utf8");
    const start = main.indexOf('if (externalStartup.kind === "rejected")');
    const uncertainty = main.indexOf('if (externalStartup.kind === "routingUnconfirmed")');
    const resolve = main.indexOf("const coldStartLaunchTarget = await resolveColdStartLaunchTarget");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(uncertainty);
    expect(uncertainty).toBeLessThan(resolve);
    const branch = main.slice(start, uncertainty);
    expect(branch).toContain("dialog.showMessageBox(externalLaunchRejectionDialog(");
    expect(branch).toContain("app.quit();");
    expect(branch).toContain("return;");
    expect(branch).not.toMatch(/openExternal|createMainWindow|spawn|routing unconfirmed/);
  });
  it("lost ACK followed by takeover is still unconfirmed, never a cold-start fallback", async () => {
    let status: PrimaryRouterStatus = { kind: "secondary", primary: self };
    const enqueue = vi.fn();
    const result = await routeExternalLaunchStartup({
      launch: launch(),
      router: async () => ({
        current: () => status,
        refresh: async () => status,
        handoff: async () => {
          status = { kind: "primary", self };
          return {
            kind: "failed",
            requestId: createUuidv7(),
            reason: "transportFailure",
            delivery: "unconfirmed",
          };
        },
      }),
      enqueue,
      policy,
    });
    expect(result).toEqual({ kind: "routingUnconfirmed", reason: "handoffUnconfirmed" });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("a definite alreadyPrimary/no-send race can enqueue locally without losing the target", async () => {
    let status: PrimaryRouterStatus = { kind: "secondary", primary: self };
    const enqueue = vi.fn(() => ({ kind: "accepted" as const }));
    expect(
      await routeExternalLaunchStartup({
        launch: launch(),
        router: async () => ({
          current: () => status,
          refresh: async () => status,
          handoff: async () => {
            status = { kind: "primary", self };
            return { kind: "notSent", reason: "alreadyPrimary" };
          },
        }),
        enqueue,
        wait: async () => {},
        policy,
      }),
    ).toMatchObject({ kind: "queuedColdStart" });
    expect(enqueue).toHaveBeenCalledOnce();
  });
  it.each(["discovering", "unavailable", "stopping"] as const)(
    "%s never becomes implicit Primary/cold-start",
    async (kind) => {
      const status =
        kind === "unavailable"
          ? { kind, reason: "coordinationFailure" as const }
          : { kind };
      const enqueue = vi.fn();
      const refresh = vi.fn(async () => status);
      expect(
        await routeExternalLaunchStartup({
          launch: launch(),
          router: async () => ({
            current: () => status,
            refresh,
            handoff: vi.fn(),
          }),
          enqueue,
          wait: async () => {},
          policy,
        }),
      ).toMatchObject({ kind: "routingUnconfirmed" });
      expect(enqueue).not.toHaveBeenCalled();
      expect(refresh.mock.calls.length).toBeLessThanOrEqual(2);
    },
  );
  it("initialization has a deadline and never falls back to filesystem/project open", async () => {
    vi.useFakeTimers();
    try {
      const result = routeExternalLaunchStartup({
        launch: launch(),
        router: () => new Promise(() => {}),
        enqueue: vi.fn(),
        policy,
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({
        kind: "routingUnconfirmed",
        reason: "coordinationUnavailable",
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("capacity rejection does not become local startup", async () => {
    expect(
      await routeExternalLaunchStartup({
        launch: launch(),
        router: async () => ({
          current: () => ({ kind: "primary", self }),
          refresh: vi.fn(),
          handoff: vi.fn(),
        }),
        enqueue: () => ({ kind: "notReadyForHandoff" }),
        policy,
      }),
    ).toEqual({ kind: "routingUnconfirmed", reason: "queueRejected" });
  });
  it("production gate and courier return precede target resolution, Project initialization and BrowserWindow creation", () => {
    const main = readFileSync("src/main/main.ts", "utf8");
    const gate = main.indexOf(
      "const externalStartup = await routeExternalLaunchStartup",
    );
    const exit = main.indexOf(
      'if (externalStartup.kind === "handedOff")',
      gate,
    );
    const resolve = main.indexOf(
      "const coldStartLaunchTarget = await resolveColdStartLaunchTarget",
    );
    const project = main.indexOf("registerProjectIpc(", gate);
    const window = main.indexOf("await createMainWindow(true)");
    expect(gate).toBeGreaterThan(0);
    expect(exit).toBeLessThan(resolve);
    expect(resolve).toBeLessThan(project);
    expect(project).toBeLessThan(window);
    const branch = main.slice(
      exit,
      main.indexOf('if (externalStartup.kind === "routingUnconfirmed")', exit),
    );
    expect(branch).toContain("app.quit()");
    expect(branch).toContain("return;");
    expect(branch).not.toContain("createMainWindow(");
  });
});
