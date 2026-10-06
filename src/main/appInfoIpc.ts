import { app, ipcMain, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APP_INFO_CHANNELS,
  APP_INFO_EXTERNAL_LINKS,
  type LegalDocumentId,
  type PergamumAppInfo
} from "../shared/api";
import { parseExternalHttpUrl } from "../shared/externalHttpUrl";

export const pergamumRepositoryUrl = APP_INFO_EXTERNAL_LINKS.repository;
export const pergamumCopyright = "Copyright (c) 2026 Pergamum IDE";

export interface AppInfoMetadataProvider {
  getName(): string;
  getVersion(): string;
  getAppPath(): string;
}

export interface RuntimeMetadataProvider {
  getElectronVersion(): string;
  getChromiumVersion(): string;
  getNodeVersion(): string;
  getV8Version(): string;
  getOsType(): string;
  getOsRelease(): string;
  getPlatform(): string;
  getArch(): string;
}

export interface ExternalLinkOpener {
  openExternal(url: string): Promise<void>;
}

/**
 * #627: file name of each legal document. Packaging copies these files from
 * the repository root to <app>/resources/ (forge.config.js extraResource,
 * package.json build.extraResources). Pergamum's own LICENSE is
 * resources/LICENSE — never the Electron LICENSE at the app root.
 */
export const LEGAL_DOCUMENT_FILE_NAMES: Readonly<Record<LegalDocumentId, string>> = {
  license: "LICENSE",
  thirdPartyLicenses: "THIRD_PARTY_LICENSES.md",
  thirdPartyNotices: "THIRD_PARTY_NOTICES.md"
};

export interface LegalDocumentLocation {
  isPackaged: boolean;
  /** process.resourcesPath of the packaged app. */
  resourcesPath: string;
  /** app.getAppPath(); the repository root in development. */
  appPath: string;
}

export interface LegalDocumentOpener {
  /** shell.openPath semantics: resolves to "" on success, else an error message. */
  openPath(fullPath: string): Promise<string>;
}

function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEGAL_DOCUMENT_FILE_NAMES, value)
  );
}

/**
 * Maps a legal document id to its fixed file: resources/<file> when packaged,
 * <repository root>/<file> in development. Anything that is not one of the
 * fixed ids resolves to null.
 */
export function resolveLegalDocumentPath(
  id: unknown,
  location: LegalDocumentLocation
): string | null {
  if (!isLegalDocumentId(id)) {
    return null;
  }

  const baseDirectory = location.isPackaged
    ? location.resourcesPath
    : location.appPath;

  return path.join(baseDirectory, LEGAL_DOCUMENT_FILE_NAMES[id]);
}

/** Opens a legal document with the OS default application; false on failure. */
export async function openLegalDocument(
  id: unknown,
  location: LegalDocumentLocation,
  opener: LegalDocumentOpener
): Promise<boolean> {
  const documentPath = resolveLegalDocumentPath(id, location);

  if (documentPath === null || !existsSync(documentPath)) {
    return false;
  }

  try {
    return (await opener.openPath(documentPath)) === "";
  } catch {
    return false;
  }
}

const electronLegalDocumentLocation = (): LegalDocumentLocation => ({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath()
});

function nonEmptyMetadata(value: string | undefined): string {
  const normalized = value?.trim() ?? "";

  return normalized.length > 0 ? normalized : "Unknown";
}

const processRuntimeMetadataProvider: RuntimeMetadataProvider = {
  getElectronVersion: () => nonEmptyMetadata(process.versions.electron),
  getChromiumVersion: () => nonEmptyMetadata(process.versions.chrome),
  getNodeVersion: () => nonEmptyMetadata(process.versions.node),
  getV8Version: () => nonEmptyMetadata(process.versions.v8),
  getOsType: () => nonEmptyMetadata(os.type()),
  getOsRelease: () => nonEmptyMetadata(os.release()),
  getPlatform: () => nonEmptyMetadata(process.platform),
  getArch: () => nonEmptyMetadata(process.arch)
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPackageLicense(appPath: string): string | null {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(appPath, "package.json"), "utf8")
    );

    if (!isRecord(packageJson) || typeof packageJson.license !== "string") {
      return null;
    }

    const license = packageJson.license.trim();

    return license.length > 0 ? license : null;
  } catch {
    return null;
  }
}

export function createPergamumAppInfo(
  metadataProvider: AppInfoMetadataProvider,
  runtimeMetadataProvider: RuntimeMetadataProvider =
    processRuntimeMetadataProvider
): PergamumAppInfo {
  return {
    name: metadataProvider.getName(),
    version: metadataProvider.getVersion(),
    license: readPackageLicense(metadataProvider.getAppPath()) ?? "Unknown",
    copyright: pergamumCopyright,
    runtime: {
      electron: runtimeMetadataProvider.getElectronVersion(),
      chromium: runtimeMetadataProvider.getChromiumVersion(),
      node: runtimeMetadataProvider.getNodeVersion(),
      v8: runtimeMetadataProvider.getV8Version(),
      osType: runtimeMetadataProvider.getOsType(),
      osRelease: runtimeMetadataProvider.getOsRelease(),
      platform: runtimeMetadataProvider.getPlatform(),
      arch: runtimeMetadataProvider.getArch()
    }
  };
}

function openFixedExternalLink(
  opener: ExternalLinkOpener,
  url: string
): Promise<void> {
  return opener.openExternal(url);
}

export function registerAppInfoIpc(options: {
  metadataProvider?: AppInfoMetadataProvider;
  runtimeMetadataProvider?: RuntimeMetadataProvider;
  externalLinkOpener?: ExternalLinkOpener;
  legalDocumentOpener?: LegalDocumentOpener;
  legalDocumentLocation?: () => LegalDocumentLocation;
} = {}): void {
  const metadataProvider = options.metadataProvider ?? app;
  const runtimeMetadataProvider =
    options.runtimeMetadataProvider ?? processRuntimeMetadataProvider;
  const externalLinkOpener = options.externalLinkOpener ?? shell;
  const legalDocumentOpener = options.legalDocumentOpener ?? shell;
  const legalDocumentLocation =
    options.legalDocumentLocation ?? electronLegalDocumentLocation;

  ipcMain.handle(APP_INFO_CHANNELS.getAppInfo, () =>
    createPergamumAppInfo(metadataProvider, runtimeMetadataProvider)
  );
  ipcMain.handle(APP_INFO_CHANNELS.openRepository, () =>
    openFixedExternalLink(externalLinkOpener, pergamumRepositoryUrl)
  );
  ipcMain.handle(APP_INFO_CHANNELS.openLegalDocument, (_event, id: unknown) =>
    // Only a fixed document id is accepted; main resolves the file itself.
    openLegalDocument(id, legalDocumentLocation(), legalDocumentOpener)
  );
  ipcMain.handle(APP_INFO_CHANNELS.openExternalUrl, (_event, url: unknown) => {
    // The renderer classifies too, but main never trusts that: parse and
    // allow only absolute http(s) URLs, and open the canonical form.
    const externalUrl = parseExternalHttpUrl(url);

    if (externalUrl === null) {
      throw new Error("Only http and https URLs are allowed.");
    }

    return openFixedExternalLink(externalLinkOpener, externalUrl);
  });
}
