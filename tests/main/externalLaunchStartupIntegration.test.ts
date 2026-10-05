import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createUuidv7 } from "../../src/shared/uuidv7";
import { createRuntimePrimaryRouter } from "../../src/main/primaryRouterEndpoint";
import { DEFAULT_PRIMARY_ROUTER_POLICY } from "../../src/main/primaryRouterCoordination";
import { createRuntimeLaunchQueue } from "../../src/main/runtimeLaunchQueue";
import { externalLaunchRejectionDialog, routeExternalLaunchStartup } from "../../src/main/externalLaunchStartup";
import { t } from "../../src/shared/i18n";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import { createRuntimeLaunchDispatcher } from "../../src/main/runtimeLaunchDispatcher";
import {
  createRuntimeMarkdownLocalHandler,
  createRuntimeMarkdownLocalReceiver,
} from "../../src/renderer/runtimeMarkdownLocalRouting";

describe("EXE drop same-project external argv regression", () => {
  it.each(["ja", "en"] as const)("Case 15-C: URL external argv terminates before routing/open/spawn and uses existing rejection wording (%s)", async (language) => {
    const queue = createRuntimeLaunchQueue({ now: () => Date.now() });
    const dispatch = vi.fn(async () => ({ kind: "accepted" as const }));
    const router = vi.fn();
    const enqueue = vi.fn(queue.enqueue);
    try {
      await queue.markReady(dispatch);
      const result = await routeExternalLaunchStartup({
        launch: parseRuntimeLaunch(["Pergamum.exe", "https://example.com/test.md"], { isPackaged: true }),
        router,
        enqueue,
      });
      expect(result).toEqual({ kind: "rejected", reason: "urlLikeInput" });
      if (result.kind !== "rejected") throw new Error("Expected terminal rejection");
      const dialog = externalLaunchRejectionDialog(result, language);
      expect(dialog.message).toBe(t(language, "dialog.startupMarkdownRejected.title"));
      expect(dialog.detail).toBe(t(language, "dialog.startupMarkdownRejected.reason.urlLikeInput"));
      expect(JSON.stringify(dialog)).not.toMatch(/既存の Pergamum|existing Pergamum|配送|delivery/);
      // No handoff or queue dispatch can reach browser/local open or child spawn.
      expect(router).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(queue.current().pending).toHaveLength(0);
    } finally {
      queue.stop();
    }
  });
  it("existing Primary A owns the authenticated handoff; B never opens Project A, shows read-only confirmation or creates a window", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "pg-external-argv-"),
    );
    const root = path.join(directory, "Project A");
    await fs.mkdir(root);
    const locator = path.join(root, "A.pergamum"),
      target = path.join(root, "chapter 日本 & ().md");
    await fs.writeFile(locator, "");
    await fs.writeFile(target, "# chapter");
    const context = {
      projectId: createUuidv7(),
      rootPath: root,
      projectFilePath: locator,
    };
    const queue = createRuntimeLaunchQueue({ now: () => Date.now() });
    const policy = {
      ...DEFAULT_PRIMARY_ROUTER_POLICY,
      scanIntervalMs: 100,
      statusFreshnessMs: 1000,
    };
    const base = {
      userDataPath: path.join(directory, "profile"),
      mode: "packaged" as const,
      policy,
    };
    const primary = await createRuntimePrimaryRouter({
      ...base,
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      handoffReceiver: queue.receiver,
    });
    const secondary = await createRuntimePrimaryRouter({
      ...base,
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 2,
    });
    const openProjectInB = vi.fn(),
      showReadOnlyDialogInB = vi.fn(),
      createWindowInB = vi.fn();
    const activate = vi.fn(async () => true),
      standalone = vi.fn(async () => true),
      promote = vi.fn(async () => ({ kind: "handled" as const }));
    const renderer = createRuntimeMarkdownLocalReceiver({
      handle: createRuntimeMarkdownLocalHandler({
        isReady: () => true,
        getContext: async () => context,
        openProjectDocument: activate,
        openStandalone: standalone,
        promoteProject: promote,
        reject: () => false,
      }),
    });
    const dispatcher = createRuntimeLaunchDispatcher({
      getContext: () => context,
      canDispatch: () => true,
      platform: process.platform === "win32" ? "windows" : "linux",
      dispatchLocal: renderer.receive,
      releaseLocal: renderer.release,
      registerDocument: (file) => path.relative(root, file),
    });
    try {
      await primary.start();
      await vi.waitFor(() => expect(primary.current().kind).toBe("primary"));
      await secondary.start();
      await vi.waitFor(() =>
        expect(secondary.current().kind).toBe("secondary"),
      );
      const result = await routeExternalLaunchStartup({
        launch: parseRuntimeLaunch(["Pergamum.exe", target], {
          isPackaged: true,
        }),
        router: async () => secondary,
        enqueue: vi.fn(() => ({ kind: "accepted" as const })),
      });
      // These are the startup side effects behind Main's actual early-return
      // branch, separately covered by the production wiring regression.
      if (result.kind === "coldStart" || result.kind === "queuedColdStart") {
        openProjectInB();
        showReadOnlyDialogInB();
        createWindowInB();
      }
      expect(result).toEqual({ kind: "handedOff" });
      expect(queue.current().pending).toHaveLength(1);
      expect(openProjectInB).not.toHaveBeenCalled();
      expect(showReadOnlyDialogInB).not.toHaveBeenCalled();
      expect(createWindowInB).not.toHaveBeenCalled();
      await secondary.stop(); // Courier exits; the accepted owner is still A.
      await queue.markReady(dispatcher.sink);
      expect(activate).toHaveBeenCalledExactlyOnceWith("chapter 日本 & ().md");
      expect(standalone).not.toHaveBeenCalled();
      expect(promote).not.toHaveBeenCalled();
      expect(queue.current().pending).toHaveLength(0);
      expect(context.projectFilePath).toBe(locator);
    } finally {
      queue.stop();
      await secondary.stop();
      await primary.stop();
      if (
        path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("pg-external-argv-")
      )
        throw new Error("Unexpected test directory.");
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20000);
});
