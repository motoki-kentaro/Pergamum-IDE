import path from "node:path";
import { EventEmitter } from "node:events";
import type { IpcMain, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeLaunchDispatcher } from "../../src/main/runtimeLaunchDispatcher";
import { createRuntimeLaunchIpc } from "../../src/main/runtimeLaunchIpc";
import { createRuntimeLaunchQueue } from "../../src/main/runtimeLaunchQueue";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import {
  createRuntimeMarkdownLocalHandler,
  createRuntimeMarkdownLocalReceiver,
  tryOwnRuntimeRejection,
} from "../../src/renderer/runtimeMarkdownLocalRouting";
import { DialogController } from "../../src/renderer/dialog/dialogController";
import {
  RUNTIME_LAUNCH_CHANNELS,
  type RuntimeProjectContext,
  type RuntimeLocalActionRequest,
  type RuntimeLocalActionResult,
} from "../../src/shared/runtimeLaunchAction";
import type { AppConfirmDialogOptions } from "../../src/renderer/dialog/appDialogTypes";

const info: AppConfirmDialogOptions = {
  title: "Cannot open",
  message: { kind: "plainText", text: "Unsupported file" },
  icon: { kind: "info", tooltip: "Info" },
  clipboardText: null,
  dismissOnBackdropClick: false,
  confirmLabel: "OK",
  cancelLabel: null,
};
const projectless: RuntimeProjectContext = {
  projectId: null,
  rootPath: null,
  projectFilePath: null,
};
const projectA: RuntimeProjectContext = {
  projectId: "A",
  rootPath: path.resolve("A"),
  projectFilePath: path.resolve("A/A.pergamum"),
};
function harness(context = projectless, dirs: Record<string, string[]> = {}) {
  let current = context;
  let ready = true;
  const ipc = new EventEmitter();
  const web = { isDestroyed: () => false, mainFrame: {}, send: vi.fn() };
  const bridge = createRuntimeLaunchIpc({
    ipc: ipc as unknown as Pick<IpcMain, "on" | "removeListener">,
    getWebContents: () => web as unknown as WebContents,
  });
  const openStandalone = vi.fn(async () => true);
  const openProjectDocument = vi.fn(async () => true);
  const promotion = vi.fn(async (): Promise<RuntimeLocalActionResult> => ({
    kind: "handled",
  }));
  const dialog = new DialogController();
  const handle = createRuntimeMarkdownLocalHandler({
    isReady: () => ready,
    getContext: async () => current,
    openStandalone,
    openProjectDocument,
    promoteProject: promotion,
    reject: () =>
      tryOwnRuntimeRejection(info, {
        confirm: (options) => dialog.confirm(options),
        getPendingRequest: () => dialog.getPendingRequest(),
      }),
  });
  const renderer = createRuntimeMarkdownLocalReceiver({ handle });
  web.send.mockImplementation(
    (channel: string, payload: RuntimeLocalActionRequest | string) => {
      if (channel === RUNTIME_LAUNCH_CHANNELS.release) {
        renderer.release(payload as string);
        return;
      }
      void renderer
        .receive(payload as RuntimeLocalActionRequest)
        .then((result) => {
          ipc.emit(
            RUNTIME_LAUNCH_CHANNELS.result,
            { sender: web, senderFrame: web.mainFrame },
            {
              requestId: (payload as RuntimeLocalActionRequest).requestId,
              result,
            },
          );
        });
    },
  );
  const dispatcher = createRuntimeLaunchDispatcher({
    getContext: () => current,
    canDispatch: () => true,
    platform: process.platform === "win32" ? "windows" : "linux",
    dispatchLocal: bridge.send,
    releaseLocal: bridge.release,
    registerDocument: (file) => path.relative(current.rootPath!, file),
    filesystem: {
      stat: async () => ({ isFile: () => true, isDirectory: () => false }),
      realpath: async (file) => path.resolve(file),
      readdir: async (directory) => dirs[directory] ?? [],
    },
  });
  const queue = createRuntimeLaunchQueue({ now: () => 0 });
  function enqueue(target: string, index = 1) {
    const launch = parseRuntimeLaunch(["Pergamum", target], {
      isPackaged: true,
    });
    if (launch.kind !== "launch") throw new Error("fixture");
    return queue.enqueue({
      requestId: "019a0000-0000-7000-8000-" + String(index).padStart(12, "0"),
      target,
      launch,
    });
  }
  return {
    queue,
    dispatcher,
    bridge,
    dialog,
    openStandalone,
    openProjectDocument,
    promotion,
    enqueue,
    setReady: (value: boolean) => {
      ready = value;
    },
    setContext: (value: RuntimeProjectContext) => {
      current = value;
    },
  };
}
describe("production-shaped queue / Main IPC / Renderer lifecycle ownership", () => {
  it("retains ownership until standalone lifecycle acknowledges completion", async () => {
    const h = harness();
    let complete!: (value: boolean) => void;
    h.openStandalone.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    expect(h.enqueue("note.md")).toEqual({ kind: "accepted" });
    const drain = h.queue.markReady(h.dispatcher.sink);
    await vi.waitFor(() => expect(h.openStandalone).toHaveBeenCalledOnce());
    expect(h.queue.current().pending).toHaveLength(1);
    complete(true);
    await drain;
    expect(h.queue.current().pending).toHaveLength(0);
    h.bridge.dispose();
  });
  it("same Project uses Project Document activation exclusively", async () => {
    const h = harness(projectA, { [path.resolve("A")]: ["A.pergamum"] });
    h.enqueue("A/chapter.md");
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.openProjectDocument).toHaveBeenCalledWith("chapter.md");
    expect(h.openStandalone).not.toHaveBeenCalled();
    expect(h.promotion).not.toHaveBeenCalled();
    expect(h.queue.current().pending).toHaveLength(0);
    h.bridge.dispose();
  });
  it("projectless promotion waits for the Project and deferred document lifecycle", async () => {
    const h = harness(projectless, { [path.resolve("A")]: ["A.pergamum"] });
    let complete!: (result: RuntimeLocalActionResult) => void;
    h.promotion.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    h.enqueue("A/chapter.md");
    const drain = h.queue.markReady(h.dispatcher.sink);
    await vi.waitFor(() => expect(h.promotion).toHaveBeenCalledOnce());
    expect(h.queue.current().pending).toHaveLength(1);
    expect(h.openStandalone).not.toHaveBeenCalled();
    h.setContext(projectA);
    complete({ kind: "handled" });
    await drain;
    expect(h.queue.current().pending).toHaveLength(0);
    h.bridge.dispose();
  });
  it("dialog controller ownership consumes rejection before OK dismissal", async () => {
    const h = harness();
    h.enqueue("note.txt");
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.dialog.getPendingRequest()).toEqual({
      kind: "confirm",
      options: info,
    });
    expect(h.queue.current().pending).toHaveLength(0);
    expect(h.openStandalone).not.toHaveBeenCalled();
    h.dialog.resolve("confirm");
    h.bridge.dispose();
  });
  it("modal conflict retains the rejection until the controller can own it", async () => {
    const h = harness();
    void h.dialog.confirm({ ...info, title: "Already open" });
    h.enqueue("note.txt");
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.queue.current().pending).toHaveLength(1);
    h.dialog.resolve("confirm");
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.queue.current().pending).toHaveLength(0);
    h.dialog.resolve("confirm");
    h.bridge.dispose();
  });
  it("restore barrier retains the request and permits a later retry", async () => {
    const h = harness();
    h.setReady(false);
    h.enqueue("note.md");
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.openStandalone).not.toHaveBeenCalled();
    expect(h.queue.current().pending).toHaveLength(1);
    h.setReady(true);
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.queue.current().pending).toHaveLength(0);
    h.bridge.dispose();
  });
  it("foreign target keeps queue ownership without any local open", async () => {
    const h = harness(projectA);
    h.enqueue("outside.md");
    await h.queue.markReady(h.dispatcher.sink);
    expect(h.queue.current().pending).toHaveLength(1);
    expect(h.openStandalone).not.toHaveBeenCalled();
    expect(h.openProjectDocument).not.toHaveBeenCalled();
    h.bridge.dispose();
  });
});
