import { EventEmitter } from "node:events";
import type { IpcMain, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeLaunchIpc } from "../../src/main/runtimeLaunchIpc";
import { createRuntimeMarkdownLocalReceiver } from "../../src/renderer/runtimeMarkdownLocalRouting";
import {
  RUNTIME_LAUNCH_CHANNELS,
  type RuntimeLocalActionRequest,
  type RuntimeLocalActionResult,
} from "../../src/shared/runtimeLaunchAction";
const request: RuntimeLocalActionRequest = {
  requestId: "019a0000-0000-7000-8000-000000000001",
  target: "/chapter.md",
  expectedContext: { projectId: null, rootPath: null, projectFilePath: null },
  action: { kind: "standalone", filePath: "/chapter.md" },
};
function harness(timeout = 100) {
  const ipc = new EventEmitter();
  const web = { isDestroyed: () => false, send: vi.fn(), mainFrame: {} };
  const bridge = createRuntimeLaunchIpc({
    ipc: ipc as unknown as Pick<IpcMain, "on" | "removeListener">,
    getWebContents: () => web as unknown as WebContents,
    policy: { acknowledgementTimeoutMs: timeout },
  });
  const respond = (
    result: RuntimeLocalActionResult,
    sender: unknown = web,
    id = request.requestId,
  ) =>
    ipc.emit(
      RUNTIME_LAUNCH_CHANNELS.result,
      { sender, senderFrame: web.mainFrame },
      { requestId: id, result },
    );
  return { ipc, web, bridge, respond };
}
describe("awaitable Main / Renderer launch ownership", () => {
  it("does not treat successful send as handled", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const result = h.bridge.send(request);
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ kind: "retryLater" });
      h.bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("requires matching id and authoritative responder", async () => {
    const h = harness();
    const result = h.bridge.send(request);
    h.respond({ kind: "handled" }, {}, request.requestId);
    h.respond(
      { kind: "handled" },
      h.web,
      "019a0000-0000-7000-8000-000000000002",
    );
    h.respond({ kind: "handled" });
    expect(await result).toEqual({ kind: "handled" });
    h.bridge.dispose();
  });
  it("shares concurrent sends and rejects id conflicts", async () => {
    const h = harness();
    const a = h.bridge.send(request),
      b = h.bridge.send(request);
    expect(await h.bridge.send({ ...request, target: "/other.md" })).toEqual({
      kind: "conflict",
    });
    expect(h.web.send).toHaveBeenCalledTimes(1);
    h.respond({ kind: "handled" });
    expect(await a).toEqual(await b);
    h.bridge.dispose();
  });
  it("lost ACK retry uses the same Renderer result without repeating local action", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const open = vi.fn(async () => ({ kind: "handled" as const }));
      const receiver = createRuntimeMarkdownLocalReceiver({ handle: open });
      let drop = true;
      h.web.send.mockImplementation(
        (channel: string, value: RuntimeLocalActionRequest) => {
          if (channel !== RUNTIME_LAUNCH_CHANNELS.action) return;
          void receiver.receive(value).then((result) => {
            if (!drop) h.respond(result);
          });
        },
      );
      const first = h.bridge.send(request);
      await vi.advanceTimersByTimeAsync(100);
      expect(await first).toEqual({ kind: "retryLater" });
      drop = false;
      expect(await h.bridge.send(request)).toEqual({ kind: "handled" });
      expect(open).toHaveBeenCalledTimes(1);
      h.bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("dispose defers ownership instead of reporting accepted", async () => {
    const h = harness();
    const result = h.bridge.send(request);
    h.bridge.dispose();
    expect(await result).toEqual({ kind: "retryLater" });
  });
});
