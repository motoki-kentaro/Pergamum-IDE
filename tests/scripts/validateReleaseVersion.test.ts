import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { validateReleaseVersion } = require(
  path.join(process.cwd(), "scripts/validateReleaseVersion.js")
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createMockRepo(options: {
  pkgVersion?: string;
  lockVersion?: string;
  packagesRootVersion?: string;
  omitLockfile?: boolean;
  omitPackagesRoot?: boolean;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pergamum-release-test-"));
  tempDirs.push(dir);

  if (options.pkgVersion !== undefined) {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "pergamum", version: options.pkgVersion }),
      "utf8"
    );
  }

  if (!options.omitLockfile && options.lockVersion !== undefined) {
    const lockContent: Record<string, unknown> = {
      name: "pergamum",
      version: options.lockVersion,
    };
    if (!options.omitPackagesRoot) {
      lockContent.packages = {
        "": {
          name: "pergamum",
          version:
            options.packagesRootVersion !== undefined
              ? options.packagesRootVersion
              : options.lockVersion,
        },
      };
    }
    fs.writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify(lockContent),
      "utf8"
    );
  }

  return dir;
}

describe("validateReleaseVersion", () => {
  it("passes when tag and package versions match exactly (including lockfile and packages[''])", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.3",
      lockVersion: "1.2.3",
      packagesRootVersion: "1.2.3",
    });
    const result = validateReleaseVersion("v1.2.3", repo);
    expect(result.valid).toBe(true);
    expect(result.version).toBe("1.2.3");
    expect(result.tagName).toBe("v1.2.3");
  });

  it("rejects when package-lock.json is missing", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.3",
      omitLockfile: true,
    });
    expect(() => validateReleaseVersion("v1.2.3", repo)).toThrow(
      "package-lock.json is required."
    );
  });

  it("rejects invalid tag formats that do not match ^v[0-9]+\\.[0-9]+\\.[0-9]+$", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.3",
      lockVersion: "1.2.3",
    });
    const invalidTags = [
      "1.2.3",
      "v1.2",
      "v1.2.3-beta",
      "v1.2.3.4",
      "release-1.2.3",
      "vX.Y.Z",
      "",
      " ",
    ];

    for (const tag of invalidTags) {
      expect(() => validateReleaseVersion(tag, repo)).toThrowError();
    }
  });

  it("rejects when tag version does not match package.json", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.2",
      lockVersion: "1.2.3",
    });
    expect(() => validateReleaseVersion("v1.2.3", repo)).toThrow(
      "Version mismatch: package.json has version '1.2.2', but tag 'v1.2.3' expects '1.2.3'."
    );
  });

  it("rejects when tag version does not match top-level package-lock.json", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.3",
      lockVersion: "1.2.2",
      packagesRootVersion: "1.2.3",
    });
    expect(() => validateReleaseVersion("v1.2.3", repo)).toThrow(
      "Version mismatch: package-lock.json top-level has version '1.2.2', but tag 'v1.2.3' expects '1.2.3'."
    );
  });

  it("rejects when package-lock.json is missing packages[''] entry", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.3",
      lockVersion: "1.2.3",
      omitPackagesRoot: true,
    });
    expect(() => validateReleaseVersion("v1.2.3", repo)).toThrow(
      "package-lock.json is missing 'packages[\"\"]' entry for the root package."
    );
  });

  it("rejects when package-lock.json packages[''].version does not match expected version", () => {
    const repo = createMockRepo({
      pkgVersion: "1.2.3",
      lockVersion: "1.2.3",
      packagesRootVersion: "1.2.2",
    });
    expect(() => validateReleaseVersion("v1.2.3", repo)).toThrow(
      "Version mismatch: package-lock.json packages[\"\"].version is '1.2.2', but tag 'v1.2.3' expects '1.2.3'."
    );
  });
});
