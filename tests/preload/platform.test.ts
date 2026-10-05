import { describe, expect, it, vi } from "vitest";
import { nodePlatformToAppPlatform } from "../../src/preload/platform";
import type { AppPlatform } from "../../src/shared/platform";

// The preload calls exposeInMainWorld once, at import time below - before any
// test runs - so what it exposed is recorded here rather than read back from
// the mock's call history (which is cleared before every test).
const electronMock = vi.hoisted(() => ({
  exposedKey: undefined as string | undefined,
  exposedApi: undefined as { platform?: AppPlatform } | undefined,
  exposeInMainWorld: vi.fn((key: string, api: { platform?: AppPlatform }) => {
    electronMock.exposedKey = key;
    electronMock.exposedApi = api;
  }),
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  send: vi.fn()
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMock.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    off: electronMock.off,
    send: electronMock.send
  }
}));

await import("../../src/preload/preload");

describe("preload exposes a renderer-safe platform value (#182)", () => {
  it("exposes platform as one of the closed AppPlatform values", () => {
    const appPlatforms: readonly AppPlatform[] = [
      "windows",
      "macos",
      "linux",
      "other"
    ];

    expect(electronMock.exposedKey).toBe("pergamum");
    expect(electronMock.exposedApi).toEqual(
      expect.objectContaining({ platform: expect.any(String) })
    );
    expect(appPlatforms).toContain(electronMock.exposedApi?.platform);
  });

  it("resolves the exposed platform via nodePlatformToAppPlatform(process.platform)", () => {
    expect(electronMock.exposedApi?.platform).toBe(
      nodePlatformToAppPlatform(process.platform)
    );
  });
});

describe("nodePlatformToAppPlatform (#182)", () => {
  it("maps win32 to windows", () => {
    expect(nodePlatformToAppPlatform("win32")).toBe("windows");
  });

  it("maps darwin to macos", () => {
    expect(nodePlatformToAppPlatform("darwin")).toBe("macos");
  });

  it("maps linux to linux", () => {
    expect(nodePlatformToAppPlatform("linux")).toBe("linux");
  });

  it("maps any other Node platform to other", () => {
    expect(nodePlatformToAppPlatform("freebsd")).toBe("other");
    expect(nodePlatformToAppPlatform("openbsd")).toBe("other");
    expect(nodePlatformToAppPlatform("aix")).toBe("other");
  });
});
