import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// #755: package.json "version" is the single source of the application
// version. Electron's app.getVersion() reads it (About, debug log, session
// diagnostics), Forge stamps it into Pergamum.exe and electron-builder names
// the installer from it, so it must not be defined a second time.
function readJson(file: string) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
}

describe("application version (#755)", () => {
  const packageJson = readJson("package.json");

  it("keeps package-lock.json in sync with package.json", () => {
    const lockfile = readJson("package-lock.json");

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockfile.version).toBe(packageJson.version);
    expect(lockfile.packages[""].version).toBe(packageJson.version);
  });

  it("is not overridden in the Forge or electron-builder configuration", () => {
    const forgeConfig = require("../../forge.config.js") as {
      packagerConfig: Record<string, unknown>;
    };

    expect(forgeConfig.packagerConfig).not.toHaveProperty("appVersion");
    expect(forgeConfig.packagerConfig).not.toHaveProperty("buildVersion");
    expect(packageJson.build).not.toHaveProperty("extraMetadata");
    expect(packageJson.build).not.toHaveProperty("buildVersion");
  });

  it("is not hard-coded in the renderer", () => {
    const appSource = fs.readFileSync(path.join(process.cwd(), "src/renderer/App.tsx"), "utf8");

    expect(appSource).not.toContain(`"${packageJson.version}"`);
    expect(appSource).not.toMatch(/let appVersion = "\d+\.\d+\.\d+"/);
  });
});
