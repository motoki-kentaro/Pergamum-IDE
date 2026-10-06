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
      selectPerMachineByDefault?: boolean;
      requestExecutionLevel?: string;
      include?: string;
    };
    fileAssociations?: unknown;
  };
  scripts?: Record<string, string>;
};

const packageJsonPath = path.join(process.cwd(), "package.json");

// #760: electron-builder's NSIS language tables are loaded once while the file
// is collected, so the cold load of app-builder-lib is not charged to the
// per-test timeout of the localization test below.
const { LangConfigurator } = require("app-builder-lib/out/targets/nsis/nsisLang");
const { lcid } = require("app-builder-lib/out/util/langs");

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
    expect(packageJson.build?.nsis?.include).toBe("build/installer.nsh");
    expect(packageJson.build?.afterPack).toBe("scripts/electronBuilderAfterPack.js");
  });

  it("installs per user by default without requesting elevation (#766)", () => {
    const nsis = readPackageJson().build?.nsis;

    // perMachine !== true keeps electron-builder's install-mode page, whose
    // default (no previous installation) is the per-user mode; nothing selects
    // per-machine by default and the installer runs at the "user" level.
    expect(nsis?.perMachine).toBe(false);
    expect(nsis?.selectPerMachineByDefault).toBeUndefined();
    expect(nsis?.requestExecutionLevel).toBeUndefined();

    const builderTemplate = (file: string) =>
      fs.readFileSync(path.join(process.cwd(), "node_modules/app-builder-lib", file), "utf8");
    const nsisTarget = builderTemplate("out/targets/nsis/NsisTarget.js");
    expect(nsisTarget).toContain('defines.REQUEST_EXECUTION_LEVEL = requestExecutionLevel || "user"');
    expect(nsisTarget).toMatch(/if \(options\.perMachine === true\) \{\s*defines\.INSTALL_MODE_PER_ALL_USERS = null;/);
    expect(builderTemplate("templates/nsis/assistedInstaller.nsh")).toMatch(
      /!ifdef INSTALL_MODE_PER_ALL_USERS_DEFAULT\s+!insertmacro setInstallModePerAllUsers\s+!else\s+!insertmacro setInstallModePerUser/
    );
    expect(builderTemplate("templates/nsis/multiUser.nsh")).toMatch(
      /!macro setInstallModePerUser\s+StrCpy \$installMode CurrentUser\s+SetShellVarContext current/
    );
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
    // Every registry write of the script lives inside that CHECKED guard, so an
    // unchecked (or silent) install writes nothing for Markdown.
    const guardedWrites = install.match(/\bWriteReg\w+/g) ?? [];
    expect(guardedWrites.length).toBeGreaterThan(0);
    expect(script.match(/\bWriteReg\w+/g)).toEqual(guardedWrites);
    const template = fs.readFileSync(path.join(process.cwd(),
      "node_modules/app-builder-lib/templates/nsis/installSection.nsh"), "utf8");
    expect(template).toContain("!insertmacro customInstall");
  });

  it("localizes Japanese and English without changing builder's bundled language set", () => {
    const script = readInstaller();
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

  // The open command written for Pergamum.Markdown: quoted executable path and
  // quoted %1, so paths with spaces stay one argument each.
  const markdownOpenCommand =
    "'$\\\"$INSTDIR\\${APP_EXECUTABLE_FILENAME}$\\\" $\\\"%1$\\\"'";

  type RegistryEntry = { root: string; key: string; valueName?: string; value?: string };

  // NSIS statements only (comments stripped), trimmed.
  function codeLines(block: string): string[] {
    return block.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith(";"));
  }

  function registryEntries(block: string, instruction: string): RegistryEntry[] {
    // An optional output variable follows ReadRegStr (e.g. `ReadRegStr $0 ...`).
    const pattern = new RegExp(`^${instruction}(?: \\$\\w+)? (\\S+) "([^"]*)"(?: "([^"]*)")?(?: (.+))?$`);
    return codeLines(block)
      .filter((line) => line.startsWith(`${instruction} `))
      .map((line) => {
        const match = line.match(pattern);
        expect(match, line).not.toBeNull();
        const [, root, key, valueName, value] = match ?? [];
        return { root, key, valueName, value };
      });
  }

  it("keeps every Markdown registry operation in the installer's own shell context, never machine-wide (#766)", () => {
    const script = readInstaller();
    const code = codeLines(script).join("\n");
    const roots = ["WriteRegStr", "ReadRegStr", "DeleteRegValue", "DeleteRegKey"]
      .flatMap((instruction) => registryEntries(script, instruction))
      .map((entry) => entry.root);

    // SHCTX follows SetShellVarContext: HKCU for the default per-user install,
    // the same root electron-builder's SHELL_CONTEXT uses for .pergamum.
    expect(roots.length).toBeGreaterThan(0);
    expect(new Set(roots)).toEqual(new Set(["SHCTX"]));
    expect(code).not.toMatch(/\b(?:HKLM|HKCU|HKCR|HKU|HKEY_[A-Z_]+)\b/);
    expect(code).not.toMatch(/SetShellVarContext|UAC_RunElevated|RequestExecutionLevel/);
    const fileAssociation = fs.readFileSync(path.join(process.cwd(),
      "node_modules/app-builder-lib/templates/nsis/include/FileAssociation.nsh"), "utf8");
    expect(fileAssociation).toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\${FILECLASS}\\shell\\open\\command"');
  });

  it("registers only the Markdown ProgID and .md OpenWithProgids, with a quoted command", () => {
    const script = readInstaller();
    const writes = registryEntries(script, "WriteRegStr");

    expect(writes.map(({ key, valueName }) => [key, valueName])).toEqual([
      ["Software\\Classes\\Pergamum.Markdown", ""],
      ["Software\\Classes\\Pergamum.Markdown\\shell\\open\\command", ""],
      ["Software\\Classes\\.md\\OpenWithProgids", "Pergamum.Markdown"]
    ]);
    expect(writes[0].value).toBe('"Markdown Document"');
    expect(writes[1].value).toBe(markdownOpenCommand);
    expect(writes[2].value).toBe('""');
    // Open with only: the .md default value (default app) is never written.
    expect(writes.some(({ key }) => key === "Software\\Classes\\.md")).toBe(false);
    expect(codeLines(script).join("\n")).not.toMatch(
      /UserChoice|DefaultIcon|SupportedTypes|Applications\\|\\\.(?:markdown|mdown|mkd|txt|pergamum)\b/i
    );
  });

  it("uninstalls only this installation's ProgID and its own OpenWith value", () => {
    const script = readInstaller();
    const uninstall = script.match(/!macro customUnInstall\s+([\s\S]*?)!macroend/)?.[1] ?? "";
    const installRoot = registryEntries(script, "WriteRegStr")[0].root;

    // Ownership: read back the command this installation wrote, in the same
    // scope, and delete only when it is exactly this installation's command.
    expect(registryEntries(uninstall, "ReadRegStr")).toEqual([
      { root: installRoot, key: "Software\\Classes\\Pergamum.Markdown\\shell\\open\\command", valueName: "", value: undefined }
    ]);
    const guard = uninstall.match(/\$\{If\} \$0 == (.+)\r?\n([\s\S]*?)\$\{EndIf\}/);
    expect(guard?.[1].trim()).toBe(markdownOpenCommand);

    const guarded = guard?.[2] ?? "";
    expect(registryEntries(guarded, "DeleteRegValue")).toEqual([
      { root: installRoot, key: "Software\\Classes\\.md\\OpenWithProgids", valueName: "Pergamum.Markdown", value: undefined }
    ]);
    expect(registryEntries(guarded, "DeleteRegKey")).toEqual([
      { root: installRoot, key: "Software\\Classes\\Pergamum.Markdown", valueName: undefined, value: undefined }
    ]);
    // Nothing is deleted outside the ownership check, and shared keys
    // (.md, its OpenWithProgids list) are never removed as a whole.
    expect(codeLines(uninstall).filter((line) => line.startsWith("DeleteReg"))).toHaveLength(2);
    expect(codeLines(uninstall.replace(guarded, "")).some((line) => line.startsWith("DeleteReg"))).toBe(false);
  });
});
