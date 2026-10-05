import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  build?: {
    afterPack?: string;
    directories?: {
      output?: string;
    };
    files?: string[];
    win?: {
      target?: string;
      icon?: string;
      fileAssociations?: Array<{
        ext?: string;
        name?: string;
        description?: string;
        icon?: string;
      }>;
    };
    nsis?: {
      perMachine?: boolean;
    };
    fileAssociations?: unknown;
  };
  scripts?: Record<string, string>;
};

const packageJsonPath = path.join(process.cwd(), "package.json");

function readPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

describe("Windows installer file association config", () => {
  it("builds the Windows NSIS installer with electron-builder", () => {
    const packageJson = readPackageJson();

    expect(packageJson.scripts?.["build:installer"]).toBe(
      "npm run typecheck && electron-forge package && electron-builder --win nsis"
    );
    expect(packageJson.build?.directories?.output).toBe("dist-installer");
    expect(packageJson.build?.files).toEqual([".vite/**/*"]);
    expect(packageJson.build?.win?.target).toBe("nsis");
    expect(packageJson.build?.win?.icon).toBe("assets/icon.ico");
    expect(packageJson.build?.nsis?.perMachine).toBe(true);
    expect(packageJson.build?.afterPack).toBe("scripts/electronBuilderAfterPack.js");
  });

  it("shares canonical Electron fuse hardening policy between Forge and electron-builder afterPack hook (#747)", () => {
    const afterPackPath = path.join(process.cwd(), "scripts/electronBuilderAfterPack.js");
    const fusePolicyPath = path.join(process.cwd(), "scripts/electronFusesPolicy.js");

    expect(fs.existsSync(afterPackPath)).toBe(true);
    expect(fs.existsSync(fusePolicyPath)).toBe(true);

    const { pergamumFusePolicy } = require(fusePolicyPath);
    const { FuseV1Options } = require("@electron/fuses");

    expect(pergamumFusePolicy[FuseV1Options.RunAsNode]).toBe(false);
    expect(pergamumFusePolicy[FuseV1Options.EnableCookieEncryption]).toBe(true);
    expect(pergamumFusePolicy[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
    expect(pergamumFusePolicy[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
    expect(pergamumFusePolicy[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true);
    expect(pergamumFusePolicy[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true);

    const forgeConfigContent = fs.readFileSync(path.join(process.cwd(), "forge.config.js"), "utf8");
    expect(forgeConfigContent).toContain("require('./scripts/electronFusesPolicy')");
    expect(forgeConfigContent).toContain("new FusesPlugin(pergamumFusePolicy)");
  });

  it("registers only .pergamum as a Windows file association", () => {
    const packageJson = readPackageJson();

    expect(packageJson.build?.fileAssociations).toBeUndefined();
    expect(packageJson.build?.win?.fileAssociations).toEqual([
      {
        ext: "pergamum",
        name: "Pergamum Project",
        description: "Pergamum Project File",
        icon: "assets/icons/file-associations/pergamum/pergamum-scroll-file-icon.ico"
      }
    ]);

    const registeredExtensions =
      packageJson.build?.win?.fileAssociations?.map((association) =>
        association.ext?.toLowerCase()
      ) ?? [];

    expect(registeredExtensions).not.toContain("md");
    expect(registeredExtensions).not.toContain("markdown");
    expect(registeredExtensions).not.toContain("txt");
  });

  it("uses the provided .pergamum file icon asset", () => {
    const packageJson = readPackageJson();
    const association = packageJson.build?.win?.fileAssociations?.[0];

    expect(association?.icon).toBe(
      "assets/icons/file-associations/pergamum/pergamum-scroll-file-icon.ico"
    );
    expect(association?.icon).not.toBe(packageJson.build?.win?.icon);

    const iconPath = path.join(process.cwd(), association?.icon ?? "");

    expect(path.extname(iconPath).toLowerCase()).toBe(".ico");
    expect(fs.existsSync(iconPath)).toBe(true);
    expect(fs.statSync(iconPath).isFile()).toBe(true);
  });
});
