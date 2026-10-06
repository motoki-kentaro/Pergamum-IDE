import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// #627 Slice 2: Pergamum's LICENSE and the third-party license / notice files
// ship in <app>/resources/ for both the Forge package and the electron-builder
// (NSIS) package, next to Electron's own LICENSE / LICENSES.chromium.html at
// the app root, which must not be replaced.
const LEGAL_FILES = ["LICENSE", "THIRD_PARTY_LICENSES.md", "THIRD_PARTY_NOTICES.md"];

type PackageJson = {
  build?: {
    extraResources?: unknown[];
    extraFiles?: unknown;
    afterPack?: string;
    nsis?: { include?: string };
  };
};

function readPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
}

describe("legal files in packaged apps (#627)", () => {
  it("exist in the repository", () => {
    for (const file of LEGAL_FILES) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
    }
  });

  it("are copied into resources/ by Forge (extraResource keeps the basename)", () => {
    const config = require("../../forge.config.js") as {
      packagerConfig: { extraResource?: string[] };
    };
    expect(config.packagerConfig.extraResource).toEqual(LEGAL_FILES);
  });

  it("are copied into resources/ by electron-builder, not into the app root", () => {
    const build = readPackageJson().build;
    expect(build?.extraResources).toEqual(LEGAL_FILES);
    // extraFiles would copy to the app root and replace Electron's LICENSE.
    expect(build?.extraFiles).toBeUndefined();
  });

  it("keeps the #747 afterPack fuse hook and the #748 NSIS include", () => {
    const build = readPackageJson().build;
    expect(build?.afterPack).toBe("scripts/electronBuilderAfterPack.js");
    expect(build?.nsis?.include).toBe("build/installer.nsh");
  });
});
