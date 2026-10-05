import type { IpcMain, WebContents } from "electron";
import {
  RUNTIME_LAUNCH_CHANNELS,
  isRuntimeLocalActionResponse,
  runtimeActionFingerprint,
  type RuntimeLocalActionRequest,
  type RuntimeLocalActionResult,
} from "../shared/runtimeLaunchAction";

export const DEFAULT_RUNTIME_LOCAL_ACTION_POLICY = {
  acknowledgementTimeoutMs: 10000,
};
/** A timeout is inconclusive: queue ownership is retained. Renderer lifetime
 * deduplication supplies the same result when the identical action is retried.
 */
export function createRuntimeLaunchIpc(options: {
  readonly ipc: Pick<IpcMain, "on" | "removeListener">;
  readonly getWebContents: () => WebContents | null;
  readonly policy?: typeof DEFAULT_RUNTIME_LOCAL_ACTION_POLICY;
  readonly onStartupSettled?: () => void;
  readonly onResume?: () => void;
}) {
  const timeoutMs =
    options.policy?.acknowledgementTimeoutMs ??
    DEFAULT_RUNTIME_LOCAL_ACTION_POLICY.acknowledgementTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid runtime local action policy.");
  const pending = new Map<
    string,
    {
      sender: WebContents;
      fingerprint: string;
      resolve: (r: RuntimeLocalActionResult) => void;
      promise: Promise<RuntimeLocalActionResult>;
    }
  >();
  let disposed = false;
  let startupSettled = false;
  const isCurrentFrame = (event: { sender: WebContents; senderFrame: unknown }) =>
    !disposed && event.sender === options.getWebContents() && event.senderFrame === event.sender.mainFrame;
  const startupListener = (event: { sender: WebContents; senderFrame: unknown }) => {
    if (!isCurrentFrame(event)) return;
    if (!startupSettled) {
      startupSettled = true;
      options.onStartupSettled?.();
    } else options.onResume?.();
  };
  const resumeListener = (event: { sender: WebContents; senderFrame: unknown }) => {
    if (startupSettled && isCurrentFrame(event)) options.onResume?.();
  };
  options.ipc.on(RUNTIME_LAUNCH_CHANNELS.startupSettled, startupListener);
  options.ipc.on(RUNTIME_LAUNCH_CHANNELS.resume, resumeListener);
  const listener = (
    event: { sender: WebContents; senderFrame: unknown },
    response: unknown,
  ) => {
    if (!isRuntimeLocalActionResponse(response)) return;
    const entry = pending.get(response.requestId);
    if (
      !entry ||
      entry.sender !== event.sender ||
      event.sender !== options.getWebContents() ||
      event.senderFrame !== event.sender.mainFrame
    )
      return;
    entry.resolve(response.result);
  };
  options.ipc.on(RUNTIME_LAUNCH_CHANNELS.result, listener);
  return {
    send(
      request: RuntimeLocalActionRequest,
    ): Promise<RuntimeLocalActionResult> {
      if (disposed) return Promise.resolve({ kind: "retryLater" });
      const fingerprint = runtimeActionFingerprint(request);
      const existing = pending.get(request.requestId);
      if (existing)
        return existing.fingerprint === fingerprint
          ? existing.promise
          : Promise.resolve({ kind: "conflict" });
      const sender = options.getWebContents();
      if (!sender || sender.isDestroyed())
        return Promise.resolve({ kind: "retryLater" });
      let resolve!: (result: RuntimeLocalActionResult) => void;
      const promise = new Promise<RuntimeLocalActionResult>((r) => {
        resolve = r;
      });
      const timer = setTimeout(
        () => resolve({ kind: "retryLater" }),
        timeoutMs,
      );
      const settled = promise.finally(() => {
        clearTimeout(timer);
        pending.delete(request.requestId);
      });
      pending.set(request.requestId, {
        sender,
        fingerprint,
        resolve,
        promise: settled,
      });
      try {
        sender.send(RUNTIME_LAUNCH_CHANNELS.action, request);
      } catch {
        resolve({ kind: "retryLater" });
      }
      return settled;
    },
    dispose() {
      disposed = true;
      options.ipc.removeListener(RUNTIME_LAUNCH_CHANNELS.result, listener);
      options.ipc.removeListener(RUNTIME_LAUNCH_CHANNELS.startupSettled, startupListener);
      options.ipc.removeListener(RUNTIME_LAUNCH_CHANNELS.resume, resumeListener);
      for (const entry of pending.values())
        entry.resolve({ kind: "retryLater" });
    },
    release(requestId: string) {
      const sender = options.getWebContents();
      if (sender && !sender.isDestroyed())
        sender.send(RUNTIME_LAUNCH_CHANNELS.release, requestId);
    },
  };
}
