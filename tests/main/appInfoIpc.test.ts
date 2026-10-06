import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_INFO_CHANNELS } from "../../src/shared/api";

const electronMock = vi.hoisted(() => ({
  appGetName: vi.fn(() => "Pergamum"),
  appGetVersion: vi.fn(() => "9.8.7-test"),
  appGetAppPath: vi.fn(() => process.cwd()),
  ipcHandle: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve())
}));

vi.mock("electron", () => ({
  app: {
    getName: electronMock.appGetName,
    getVersion: electronMock.appGetVersion,
    getAppPath: electronMock.appGetAppPath
  },
  ipcMain: {
    handle: electronMock.ipcHandle
  },
  shell: {
    openExternal: electronMock.openExternal
  }
}));

import {
  createPergamumAppInfo,
  pergamumCopyright,
  pergamumRepositoryUrl,
  readPackageLicense,
  registerAppInfoIpc,
  LEGAL_DOCUMENT_FILE_NAMES,
  openLegalDocument,
  resolveLegalDocumentPath,
  type AppInfoMetadataProvider,
  type ExternalLinkOpener,
  type LegalDocumentLocation,
  type RuntimeMetadataProvider
} from "../../src/main/appInfoIpc";

const runtimeMetadataProvider: RuntimeMetadataProvider = {
  getElectronVersion: () => "43.4.0-test",
  getChromiumVersion: () => "140.0.0-test",
  getNodeVersion: () => "24.0.0-test",
  getV8Version: () => "14.0-test",
  getOsType: () => "Windows_NT",
  getOsRelease: () => "10.0.26100-test",
  getPlatform: () => "win32",
  getArch: () => "x64"
};

const expectedRuntimeInfo = {
  electron: "43.4.0-test",
  chromium: "140.0.0-test",
  node: "24.0.0-test",
  v8: "14.0-test",
  osType: "Windows_NT",
  osRelease: "10.0.26100-test",
  platform: "win32",
  arch: "x64"
};

describe("app info IPC (#221)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates app info from Electron app version and package license metadata", () => {
    const appPath = withAppMetadata({
      packageJson: { license: "MIT" }
    });
    const metadataProvider: AppInfoMetadataProvider = {
      getName: () => "Pergamum",
      getVersion: () => "9.8.7-test",
      getAppPath: () => appPath
    };

    try {
      expect(
        createPergamumAppInfo(metadataProvider, runtimeMetadataProvider)
      ).toEqual({
        name: "Pergamum",
        version: "9.8.7-test",
        license: "MIT",
        copyright: pergamumCopyright,
        runtime: expectedRuntimeInfo
      });
    } finally {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it("returns null when package license metadata is missing", () => {
    const appPath = withAppMetadata({ packageJson: { name: "pergamum" } });

    try {
      expect(readPackageLicense(appPath)).toBeNull();
    } finally {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it("uses explicit app metadata for copyright without filesystem discovery", () => {
    const appPath = withAppMetadata({ packageJson: { license: "MIT" } });
    const metadataProvider: AppInfoMetadataProvider = {
      getName: () => "Pergamum",
      getVersion: () => "9.8.7-test",
      getAppPath: () => appPath
    };

    try {
      expect(
        createPergamumAppInfo(metadataProvider, runtimeMetadataProvider)
          .copyright
      ).toBe(pergamumCopyright);
      expect(
        createPergamumAppInfo(metadataProvider, runtimeMetadataProvider)
          .copyright
      ).not.toBe("Unknown");
    } finally {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it("registers getAppInfo and fixed external-link actions", async () => {
    const appPath = withAppMetadata({
      packageJson: { license: "Test-License" }
    });
    const metadataProvider: AppInfoMetadataProvider = {
      getName: () => "Pergamum",
      getVersion: () => "9.8.7-test",
      getAppPath: () => appPath
    };
    const externalLinkOpener: ExternalLinkOpener = {
      openExternal: vi.fn(() => Promise.resolve())
    };

    try {
      registerAppInfoIpc({
        metadataProvider,
        runtimeMetadataProvider,
        externalLinkOpener
      });

      expect(await ipcHandler(APP_INFO_CHANNELS.getAppInfo)({})).toEqual({
        name: "Pergamum",
        version: "9.8.7-test",
        license: "Test-License",
        copyright: pergamumCopyright,
        runtime: expectedRuntimeInfo
      });
      await ipcHandler(APP_INFO_CHANNELS.openRepository)(
        {},
        "https://example.invalid/not-allowed"
      );

      expect(externalLinkOpener.openExternal).toHaveBeenCalledWith(
        pergamumRepositoryUrl
      );
      expect(pergamumRepositoryUrl).toBe(
        "https://github.com/Pergamum-IDE/Pergamum-IDE"
      );
      // The handler ignores any argument — it only ever opens the fixed URL.
      expect(externalLinkOpener.openExternal).not.toHaveBeenCalledWith(
        "https://example.invalid/not-allowed"
      );
      // #627: legal documents are opened from the installed app, not from
      // GitHub; the old fixed GitHub notices channel and URL are gone.
      expect(APP_INFO_CHANNELS as Record<string, unknown>).not.toHaveProperty(
        "openThirdPartyNotices"
      );
      expect(APP_INFO_CHANNELS as Record<string, unknown>).not.toHaveProperty(
        "openTypewriterSoundsCredit"
      );
      expect(electronMock.ipcHandle).toHaveBeenCalledWith(
        "appInfo:openLegalDocument",
        expect.any(Function)
      );
    } finally {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it("does not discover copyright from LICENSE files or runtime dates", () => {
    const source = readFileSync("src/main/appInfoIpc.ts", "utf8");

    expect(source).toContain(
      'export const pergamumCopyright = "Copyright (c) 2026 Pergamum IDE";'
    );
    expect(source).not.toContain("readAppCopyright");
    // #627: LICENSE is only mapped as an openable legal document, never read.
    expect(source).not.toMatch(/readFileSync\([^)]*LICENSE/);
    expect(source).not.toContain("getFullYear");
    expect(source).not.toContain("new Date");
  });
});

describe("legal documents (#627)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const packaged: LegalDocumentLocation = {
    isPackaged: true,
    resourcesPath: path.join("C:", "Program Files", "Pergamum", "resources"),
    appPath: path.join("C:", "Program Files", "Pergamum", "resources", "app.asar")
  };

  it("maps each fixed id to its file in resources/ when packaged", () => {
    expect(LEGAL_DOCUMENT_FILE_NAMES).toEqual({
      license: "LICENSE",
      thirdPartyLicenses: "THIRD_PARTY_LICENSES.md",
      thirdPartyNotices: "THIRD_PARTY_NOTICES.md"
    });
    expect(resolveLegalDocumentPath("license", packaged)).toBe(
      path.join(packaged.resourcesPath, "LICENSE")
    );
    expect(resolveLegalDocumentPath("thirdPartyLicenses", packaged)).toBe(
      path.join(packaged.resourcesPath, "THIRD_PARTY_LICENSES.md")
    );
    expect(resolveLegalDocumentPath("thirdPartyNotices", packaged)).toBe(
      path.join(packaged.resourcesPath, "THIRD_PARTY_NOTICES.md")
    );
  });

  it("uses the repository root (app path) in development", () => {
    const development = { isPackaged: false, resourcesPath: "unused", appPath: process.cwd() };

    for (const id of ["license", "thirdPartyLicenses", "thirdPartyNotices"] as const) {
      const resolved = resolveLegalDocumentPath(id, development);
      expect(resolved).toBe(path.join(process.cwd(), LEGAL_DOCUMENT_FILE_NAMES[id]));
    }
  });

  it.each([
    ["an arbitrary path", "C:\\Windows\\System32\\drivers\\etc\\hosts"],
    ["a relative traversal", "../LICENSE"],
    ["a file name", "LICENSE"],
    ["a prototype key", "toString"],
    ["a non-string", { id: "license" }]
  ])("rejects %s from the renderer", async (_label, id) => {
    const opener = { openPath: vi.fn(() => Promise.resolve("")) };

    expect(resolveLegalDocumentPath(id, packaged)).toBeNull();
    await expect(openLegalDocument(id, packaged, opener)).resolves.toBe(false);
    expect(opener.openPath).not.toHaveBeenCalled();
  });

  it("opens the existing file and reports missing files or open errors as false", async () => {
    const development = { isPackaged: false, resourcesPath: "unused", appPath: process.cwd() };
    const opener = { openPath: vi.fn(() => Promise.resolve("")) };

    await expect(openLegalDocument("thirdPartyNotices", development, opener)).resolves.toBe(true);
    expect(opener.openPath).toHaveBeenCalledWith(path.join(process.cwd(), "THIRD_PARTY_NOTICES.md"));

    const missing = { ...development, appPath: path.join(os.tmpdir(), "pergamum-no-such-dir") };
    await expect(openLegalDocument("license", missing, opener)).resolves.toBe(false);
    expect(opener.openPath).toHaveBeenCalledTimes(1);

    const failing = { openPath: vi.fn(() => Promise.resolve("No application is associated")) };
    await expect(openLegalDocument("license", development, failing)).resolves.toBe(false);
    const throwing = { openPath: vi.fn(() => Promise.reject(new Error("boom"))) };
    await expect(openLegalDocument("license", development, throwing)).resolves.toBe(false);
  });

  it("routes the IPC handler through the fixed-id resolver", async () => {
    const legalDocumentOpener = { openPath: vi.fn(() => Promise.resolve("")) };
    registerAppInfoIpc({
      runtimeMetadataProvider,
      externalLinkOpener: { openExternal: vi.fn(() => Promise.resolve()) },
      legalDocumentOpener,
      legalDocumentLocation: () => ({ isPackaged: false, resourcesPath: "unused", appPath: process.cwd() })
    });

    await expect(ipcHandler(APP_INFO_CHANNELS.openLegalDocument)({}, "thirdPartyLicenses")).resolves.toBe(true);
    await expect(ipcHandler(APP_INFO_CHANNELS.openLegalDocument)({}, "C:\\evil.exe")).resolves.toBe(false);
    expect(legalDocumentOpener.openPath.mock.calls).toEqual([
      [path.join(process.cwd(), "THIRD_PARTY_LICENSES.md")]
    ]);
  });
});

function withAppMetadata({
  packageJson
}: {
  packageJson: Record<string, unknown>;
}): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pergamum-app-info-"));

  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify(packageJson),
    "utf8"
  );

  return directory;
}

function ipcHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = electronMock.ipcHandle.mock.calls.find(
    (call) => call[0] === channel
  )?.[1];

  if (typeof handler !== "function") {
    throw new Error(`Missing IPC handler: ${channel}`);
  }

  return handler as (...args: unknown[]) => unknown;
}
