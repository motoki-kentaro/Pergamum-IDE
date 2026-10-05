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
      oneClick?: boolean;
      perMachine?: boolean;
      include?: string;
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
    expect(packageJson.build?.nsis?.oneClick).toBe(false);
    expect(packageJson.build?.nsis?.perMachine).toBe(true);
    expect(packageJson.build?.nsis?.include).toBe("build/installer.nsh");
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

  // These are source-contract checks, not evidence of rendered installer UI.
  // The built NSIS installer still needs OFF/ON and uninstall dogfood on Windows.
  function readInstaller(): string {
    const nshPath = path.join(process.cwd(), "build/installer.nsh");
    return fs.readFileSync(nshPath, "utf8");
  }

  it("adds exactly one checkbox through an available assisted-installer page hook", () => {
    const script = readInstaller();
    const template = fs.readFileSync(path.join(process.cwd(),
      "node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh"), "utf8");
    expect(template).toContain("!insertmacro customPageAfterChangeDir");
    expect(template.indexOf("!insertmacro customPageAfterChangeDir"))
      .toBeLessThan(template.indexOf("!insertmacro MUI_PAGE_INSTFILES"));
    expect(script).toMatch(/!macro customPageAfterChangeDir\s+Page custom PergamumMarkdownPage PergamumMarkdownPageLeave/);
    expect(script.match(/\$\{NSD_CreateCheckbox\}/g)).toHaveLength(1);
    expect(script).toContain("nsDialogs::Create 1018");
    expect(script).toContain("nsDialogs::Show");
    expect(script).not.toMatch(/MUI_PAGE_COMPONENTS|Section\s+\/o/);
  });

  it("initializes OFF, retains page state, and guards every registry write by CHECKED", () => {
    const script = readInstaller();
    expect(script).toContain("StrCpy $PergamumMarkdownSelected ${BST_UNCHECKED}");
    expect(script).toContain("${NSD_SetState} $PergamumMarkdownCheckbox $PergamumMarkdownSelected");
    expect(script).toContain("${NSD_GetState} $PergamumMarkdownCheckbox $PergamumMarkdownSelected");
    const install = script.match(/!macro customInstall\s+([\s\S]*?)!macroend/)?.[1] ?? "";
    expect(install.trim()).toMatch(/^\$\{If\} \$PergamumMarkdownSelected == \$\{BST_CHECKED\}[\s\S]*\$\{EndIf\}$/);
    expect(install).not.toMatch(/\$\{Else|\$\{OrIf/);
    expect(install.match(/WriteRegStr/g)).toHaveLength(3);
    expect(script.match(/WriteRegStr/g)).toHaveLength(3);
    const template = fs.readFileSync(path.join(process.cwd(),
      "node_modules/app-builder-lib/templates/nsis/installSection.nsh"), "utf8");
    expect(template).toContain("!insertmacro customInstall");
  });

  it("localizes Japanese and English without changing builder's bundled language set", () => {
    const script = readInstaller();
    const { LangConfigurator } = require("app-builder-lib/out/targets/nsis/nsisLang");
    const { lcid } = require("app-builder-lib/out/util/langs");
    const languages: string[] = new LangConfigurator(readPackageJson().build?.nsis ?? {}).langs;
    expect(languages).toContain("en_US");
    expect(languages).toContain("ja_JP");
    const fallbackIds = [...script.matchAll(/^!insertmacro PergamumMarkdownEnglish (\d+)/gm)]
      .map((match) => Number(match[1]));
    expect([...fallbackIds, 1041].sort()).toEqual(languages.map((lang) => lcid[lang]).sort());
    for (const name of ["Title", "Description", "Checkbox", "Hint"]) {
      expect(script).toContain(`LangString PergamumMarkdown${name} 1041`);
      expect(script).toContain(`LangString PergamumMarkdown${name} \${LANG}`);
      expect(script).toContain(`$(PergamumMarkdown${name})`);
    }
  });

  it("registers only the Markdown ProgID and .md OpenWithProgids, with a quoted command", () => {
    const script = readInstaller();
    const writes = script.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line.startsWith("WriteReg"));
    expect(writes).toEqual([
      'WriteRegStr HKLM "Software\\Classes\\Pergamum.Markdown" "" "Markdown Document"',
      "WriteRegStr HKLM \"Software\\Classes\\Pergamum.Markdown\\shell\\open\\command\" \"\" '$\\\"$INSTDIR\\${APP_EXECUTABLE_FILENAME}$\\\" $\\\"%1$\\\"'",
      'WriteRegStr HKLM "Software\\Classes\\.md\\OpenWithProgids" "Pergamum.Markdown" ""'
    ]);
    expect(script).not.toMatch(/UserChoice|DefaultIcon|SupportedTypes|Applications\\|\\\.(?:markdown|mdown|mkd|txt|pergamum)\b/i);
  });

  it("uninstalls only this installation's ProgID and its own OpenWith value", () => {
    const uninstall = readInstaller().match(/!macro customUnInstall\s+([\s\S]*?)!macroend/)?.[1] ?? "";
    expect(uninstall).toContain('ReadRegStr $0 HKLM "Software\\Classes\\Pergamum.Markdown\\shell\\open\\command" ""');
    expect(uninstall).toContain("${If} $0 ==");
    expect(uninstall.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("DeleteReg"))).toEqual([
      'DeleteRegValue HKLM "Software\\Classes\\.md\\OpenWithProgids" "Pergamum.Markdown"',
      'DeleteRegKey HKLM "Software\\Classes\\Pergamum.Markdown"'
    ]);
  });
});
