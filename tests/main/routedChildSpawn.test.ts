import { describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ spawn: vi.fn(), unref: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: fixture.spawn }));
import { spawnRoutedProcess } from "../../src/main/routedChildRouter";
import { takeRoutedChildMetadata } from "../../src/main/routedChildClaim";
import { createUuidv7 } from "../../src/shared/uuidv7";
describe("production independent process adapter", () => {
  it.each([true, false])(
    "uses shell-free packaged=%s argv and fresh environment",
    (packaged) => {
      fixture.spawn.mockReset();
      fixture.unref.mockReset();
      fixture.spawn.mockReturnValue({ pid: 10, unref: fixture.unref });
      const target = 'C:\\日本語 & (folder)\\a "quoted".md';
      const metadata = {
        requestId: createUuidv7(),
        attemptId: createUuidv7(),
        parentInstanceRunId: createUuidv7(),
        endpoint: "pipe",
        nonce: "a".repeat(64),
        secret: "b".repeat(64),
      };
      spawnRoutedProcess({
        executable: "Electron.exe",
        appPath: "C:/app entry",
        packaged,
        target,
        metadata,
        environment: {
          VITE_DEV_SERVER_URL: "http://localhost:1234",
          PERGAMUM_ROUTED_CHILD_OLD: "old",
          ELECTRON_RUN_AS_NODE: "1",
        },
      });
      expect(fixture.spawn).toHaveBeenCalledWith(
        "Electron.exe",
        [
          ...(packaged ? [] : ["C:/app entry"]),
          "--pergamum-routed-launch=v1",
          target,
        ],
        expect.objectContaining({
          shell: false,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          windowsVerbatimArguments: false,
        }),
      );
      const env = fixture.spawn.mock.calls[0][2].env;
      expect(takeRoutedChildMetadata(env)).toEqual(metadata);
      expect(env).toEqual({ VITE_DEV_SERVER_URL: "http://localhost:1234" });
      expect(fixture.unref).toHaveBeenCalledOnce();
    },
  );
});
