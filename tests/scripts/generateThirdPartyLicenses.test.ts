import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #627: THIRD_PARTY_LICENSES.md generator (CommonJS script, like the other
// scripts/*.js required by tests).
const generator = require(path.join(process.cwd(), "scripts/generateThirdPartyLicenses.js"));

type FixturePackage = {
  lockPath: string;
  version: string;
  dev?: boolean;
  optional?: boolean;
  packageJson?: Record<string, unknown> | null;
  files?: Record<string, string>;
};

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createFixture(packages: FixturePackage[]) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pergamum-licenses-"));
  tempRoots.push(rootDir);
  const lockPackages: Record<string, unknown> = { "": { name: "fixture" } };
  for (const pkg of packages) {
    lockPackages[pkg.lockPath] = {
      version: pkg.version,
      ...(pkg.dev ? { dev: true } : {}),
      ...(pkg.optional ? { optional: true } : {}),
    };
    if (pkg.packageJson === null) continue;
    const dir = path.join(rootDir, pkg.lockPath);
    fs.mkdirSync(dir, { recursive: true });
    const name = pkg.lockPath.slice(pkg.lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version: pkg.version, license: "MIT", ...pkg.packageJson }),
    );
    for (const [file, content] of Object.entries(pkg.files ?? { LICENSE: `MIT License\nCopyright ${name}\n` })) {
      fs.writeFileSync(path.join(dir, file), content);
    }
  }
  return { rootDir, lockfile: { lockfileVersion: 3, packages: lockPackages } };
}

function build(
  packages: FixturePackage[],
  overrides: Record<string, unknown> = {},
  upstreamFiles: Record<string, string> = {},
) {
  const { rootDir, lockfile } = createFixture(packages);
  const upstreamDir = path.join(rootDir, "scripts/thirdPartyLicenses");
  for (const [file, content] of Object.entries(upstreamFiles)) {
    fs.mkdirSync(upstreamDir, { recursive: true });
    fs.writeFileSync(path.join(upstreamDir, file), content);
  }
  return generator.buildThirdPartyLicenseInventory({ rootDir, lockfile, overrides });
}

describe("generateThirdPartyLicenses (fixtures)", () => {
  it("takes the non-dev lockfile closure, unique by name@version, sorted", () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/zeta": { version: "1.0.0" },
        "node_modules/alpha": { version: "2.0.0" },
        "node_modules/zeta/node_modules/alpha": { version: "10.0.0" },
        "node_modules/beta/node_modules/alpha": { version: "2.0.0" },
        "node_modules/devonly": { version: "1.0.0", dev: true },
        "node_modules/opt": { version: "1.0.0", optional: true },
      },
    };
    expect(generator.collectProductionPackages(lockfile).map((pkg: { id: string }) => pkg.id)).toEqual([
      "alpha@2.0.0",
      "alpha@10.0.0",
      "opt@1.0.0",
      "zeta@1.0.0",
    ]);
  });

  it("picks root-level license and notice files only", () => {
    const { rootDir } = createFixture([
      {
        lockPath: "node_modules/a",
        version: "1.0.0",
        files: {
          LICENSE: "x",
          "license-mit": "x",
          "NOTICE.md": "x",
          "licenses.json": "{}",
          "license.js": "",
          "README.md": "x",
        },
      },
    ]);
    expect(generator.findLicenseFiles(path.join(rootDir, "node_modules/a"))).toEqual([
      "LICENSE",
      "NOTICE.md",
      "license-mit",
    ]);
  });

  it("keeps multi-license expressions as declared", () => {
    const inventory = build([
      { lockPath: "node_modules/dual", version: "1.0.0", packageJson: { license: "(MPL-2.0 OR Apache-2.0)" } },
    ]);
    const markdown = generator.renderThirdPartyLicensesMarkdown(inventory);
    expect(markdown).toContain("- License: `(MPL-2.0 OR Apache-2.0)`");
  });

  it("is deterministic regardless of lockfile and directory order", () => {
    const packages: FixturePackage[] = [
      { lockPath: "node_modules/b", version: "1.0.0", files: { "LICENSE.md": "B\r\nline  \r\n" } },
      { lockPath: "node_modules/a", version: "1.0.0" },
    ];
    const first = generator.renderThirdPartyLicensesMarkdown(build(packages));
    const second = generator.renderThirdPartyLicensesMarkdown(build([...packages].reverse()));
    expect(second).toBe(first);
    expect(first).not.toContain("\r");
    expect(first).not.toMatch(/[ \t]$/m);
  });

  it.each([
    ["missing license metadata", { packageJson: { license: undefined } }, "license metadata missing"],
    ["missing license text", { files: { "README.md": "no license" } }, "no license text found"],
    ["version mismatch", { packageJson: { version: "9.9.9" } }, "does not match package-lock.json"],
    ["package not installed", { packageJson: null }, "not installed"],
  ])("fails on %s instead of skipping", (_label, change, message) => {
    expect(() => build([{ lockPath: "node_modules/x", version: "1.0.0", ...change }])).toThrow(message);
  });

  it("rejects unused and rewriting overrides", () => {
    const pkg: FixturePackage = { lockPath: "node_modules/x", version: "1.0.0" };
    expect(() => build([pkg], { packages: { "x@0.9.0": { reason: "old" } } })).toThrow("unused");
    expect(() =>
      build([pkg], {
        packages: { "x@1.0.0": { reason: "r", license: "Apache-2.0", licenseEvidence: { file: "LICENSE", text: "MIT" } } },
      }),
    ).toThrow('override "license" is not allowed');
    expect(() =>
      build([pkg], { packages: { "x@1.0.0": { reason: "r", noticeExcerpts: [{ file: "LICENSE", from: "MIT License" }] } } }),
    ).toThrow("unnecessary");
    expect(() => build([pkg], { packages: { "x@1.0.0": { reason: "r", typo: true } } })).toThrow("unknown override key");
  });

  it("accepts only overrides backed by package files", () => {
    const pkg: FixturePackage = {
      lockPath: "node_modules/x",
      version: "1.0.0",
      packageJson: { license: undefined },
      files: { "README.md": "# x\n\n## License\n\nMIT (c) Someone\n" },
    };
    const good = {
      reason: "r",
      license: "MIT",
      licenseEvidence: { file: "README.md", text: "MIT (c) Someone" },
      noticeExcerpts: [{ file: "README.md", from: "## License" }],
    };
    const inventory = build([pkg], { packages: { "x@1.0.0": good } });
    expect(inventory.packages[0].texts).toEqual([{ title: "README.md (excerpt)", text: "## License\n\nMIT (c) Someone" }]);

    expect(() =>
      build([pkg], { packages: { "x@1.0.0": { ...good, licenseEvidence: { file: "README.md", text: "Apache" } } } }),
    ).toThrow("licenseEvidence");
    expect(() =>
      build([pkg], { packages: { "x@1.0.0": { ...good, noticeExcerpts: [{ file: "README.md", from: "## Licence" }] } } }),
    ).toThrow("found 0 times");
  });

  describe("upstream license files", () => {
    const pkg: FixturePackage = {
      lockPath: "node_modules/x",
      version: "1.0.0",
      packageJson: { license: "MIT" },
      files: { "README.md": "# x\n" },
    };
    const upstream = {
      file: "x@1.0.0.license",
      source: "https://example.invalid/x/blob/abc/license",
      provenance: "root license at tag v1.0.0",
    };
    const overridesWith = (entry: Record<string, unknown>) => ({
      packages: { "x@1.0.0": { reason: "r", upstreamLicenseFiles: [{ ...upstream, ...entry }] } },
    });

    it("includes the stored text with its source, keeping the declared license", () => {
      const inventory = build([pkg], overridesWith({}), { "x@1.0.0.license": "Full MIT text\r\n" });
      const [entry] = inventory.packages;
      expect(entry.license).toBe("MIT");
      expect(entry.texts).toEqual([{ title: "license (upstream, not in the published package)", text: "Full MIT text" }]);
      expect(entry.notes.join("\n")).toContain(upstream.source);
    });

    it.each([
      ["a file for another version", { file: "x@0.9.0.license" }, {}, 'must start with "x@1.0.0."'],
      ["a missing file", {}, {}, "does not exist"],
      ["a missing source", { source: undefined }, { "x@1.0.0.license": "t" }, 'needs an https "source"'],
      ["a missing provenance", { provenance: "" }, { "x@1.0.0.license": "t" }, 'needs a "provenance"'],
    ])("rejects %s", (_label, entry, files, message) => {
      expect(() => build([pkg], overridesWith(entry), files)).toThrow(message);
    });

    it("rejects stored files no override references", () => {
      expect(() => build([pkg], overridesWith({}), { "x@1.0.0.license": "t", "x@0.9.0.license": "old" })).toThrow(
        "x@0.9.0.license: not referenced by any override (unused)",
      );
    });

    it("rejects them when the package already ships a license file", () => {
      expect(() =>
        build([{ ...pkg, files: { LICENSE: "MIT" } }], overridesWith({}), { "x@1.0.0.license": "t" }),
      ).toThrow('"upstreamLicenseFiles" is unnecessary');
    });
  });
});

describe("THIRD_PARTY_LICENSES.md (repository)", () => {
  const rootDir = process.cwd();
  const { inventory, markdown } = generator.generateThirdPartyLicenses(rootDir);
  const lockfile = JSON.parse(fs.readFileSync(path.join(rootDir, "package-lock.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const ids = new Set(inventory.packages.map((pkg: { id: string }) => pkg.id));

  it("matches the committed file (run npm run generate:third-party-licenses)", () => {
    const committed = fs.readFileSync(path.join(rootDir, generator.OUTPUT_FILE_NAME), "utf8").replace(/\r\n/g, "\n");
    expect(committed === markdown).toBe(true);
    expect(generator.generateThirdPartyLicenses(rootDir).markdown === markdown).toBe(true);
  });

  it("covers exactly the production closure of package-lock.json with matching versions", () => {
    const expected = new Set<string>();
    for (const [lockPath, entry] of Object.entries<{ dev?: boolean; version: string }>(lockfile.packages)) {
      if (lockPath === "" || entry.dev) continue;
      const name = lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
      expected.add(`${name}@${entry.version}`);
    }
    expect([...ids].sort()).toEqual([...expected].sort());
    for (const name of Object.keys(packageJson.dependencies)) {
      expect(ids.has(`${name}@${lockfile.packages[`node_modules/${name}`].version}`)).toBe(true);
    }
  });

  it("includes the Japanese linter packages and the kuromoji dictionary notice", () => {
    for (const name of ["markdownlint", "textlint", "@textlint/kernel", "textlint-rule-preset-japanese", "kuromoji"]) {
      expect(inventory.packages.some((pkg: { name: string }) => pkg.name === name)).toBe(true);
    }
    const kuromoji = inventory.packages.find((pkg: { name: string }) => pkg.name === "kuromoji");
    const notice = kuromoji.texts.find((text: { title: string }) => text.title === "NOTICE.md");
    expect(notice.text).toContain("mecab-ipadic-2.7.0-20070801");
    expect(notice.text).toContain("Nara Institute of Science");
  });

  it("keeps every declared license expression unchanged", () => {
    const lockPaths = new Map<string, string>(
      generator
        .collectProductionPackages(lockfile)
        .map((pkg: { id: string; lockPath: string }) => [pkg.id, pkg.lockPath]),
    );
    let declared = 0;
    for (const pkg of inventory.packages) {
      const installed = JSON.parse(fs.readFileSync(path.join(rootDir, lockPaths.get(pkg.id) ?? "", "package.json"), "utf8"));
      if (typeof installed.license !== "string") continue;
      declared += 1;
      expect(pkg.license).toBe(installed.license);
    }
    expect(declared).toBeGreaterThan(inventory.packages.length - 5);
  });

  it("includes the stored upstream license texts in full", () => {
    const upstreamDir = path.join(rootDir, "scripts/thirdPartyLicenses");
    for (const file of fs.readdirSync(upstreamDir)) {
      const pkg = inventory.packages.find((candidate: { id: string }) => file.startsWith(`${candidate.id}.`));
      const stored = fs
        .readFileSync(path.join(upstreamDir, file), "utf8")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/^\n+|\n+$/g, "");
      expect(pkg.texts.some((text: { text: string }) => text.text === stored)).toBe(true);
      expect(markdown).toContain(stored);
    }
  });

  it("includes the Electron runtime license at the pinned version", () => {
    expect(inventory.runtimes.map((pkg: { id: string }) => pkg.id)).toEqual([
      `electron@${packageJson.devDependencies.electron}`,
    ]);
  });

  it("does not leak local paths", () => {
    expect(markdown).not.toContain(rootDir);
    expect(markdown).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
  });
});
