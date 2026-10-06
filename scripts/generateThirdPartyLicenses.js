#!/usr/bin/env node
/**
 * Generates THIRD_PARTY_LICENSES.md from the npm production dependency
 * closure (#627).
 *
 * Usage:
 *   npm run generate:third-party-licenses          # rewrite the file
 *   npm run generate:third-party-licenses -- --check  # fail on drift
 *
 * Source of truth:
 *   - package-lock.json (lockfileVersion 3) decides WHICH packages are in the
 *     production closure: every `packages` entry that is not `dev`. That is
 *     exactly what `npm ci --omit=dev` installs, and it is what the packaged
 *     app ships today (the NSIS build copies the production node_modules; the
 *     Forge build bundles a subset of it via Vite).
 *   - node_modules/<package>/ provides the facts for each package: the
 *     installed package.json (version, license, repository) and the license /
 *     notice files at the package root, copied verbatim.
 *
 * Nothing is guessed. A package whose license expression or license text
 * cannot be resolved makes the generator fail; such cases are resolved with an
 * entry in scripts/thirdPartyLicenseOverrides.json, which may only supply
 * facts that are verifiable inside the installed package (see resolvePackage
 * below), or point to an upstream license file stored verbatim in
 * scripts/thirdPartyLicenses/ when the published package lacks one. Overrides
 * and those files are keyed by name@version, so they become "unused" (and
 * fail) when the package is updated or removed. The generator never accesses
 * the network.
 *
 * Electron is a devDependency in npm terms, but its runtime is redistributed
 * with the app. Its own LICENSE is included here; the licenses of the
 * components inside Electron (Chromium, Node.js, V8, ...) are covered by the
 * LICENSES.chromium.html file that Electron distributes next to the
 * executable, which is intentionally not re-generated.
 *
 * Output is deterministic: no timestamps, stable ordering, LF line endings.
 */

const fs = require("node:fs");
const path = require("node:path");

const OUTPUT_FILE_NAME = "THIRD_PARTY_LICENSES.md";
const OVERRIDES_RELATIVE_PATH = "scripts/thirdPartyLicenseOverrides.json";
const UPSTREAM_LICENSE_DIR = "scripts/thirdPartyLicenses";

// Root-level files that carry license, copyright or notice text, e.g.
// LICENSE, LICENSE.md, LICENCE, license-mit, LICENSE-2.0.txt, COPYING,
// NOTICE.md. A suffix must start with a separator so that files such as
// `licenses.json` are not picked up.
const LICENSE_FILE_PATTERN =
  /^(?:licen[cs]e|copying|notice|copyright|patents|unlicense)(?:[-._][^/]*)?$/i;
const NON_LICENSE_EXTENSIONS = /\.(?:js|cjs|mjs|ts|json|d\.ts|map)$/i;

const OVERRIDE_KEYS = new Set([
  "reason",
  "license",
  "licenseEvidence",
  "noticeExcerpts",
  "upstreamLicenseFiles",
  "noLicenseText",
  "notes",
]);
const UPSTREAM_LICENSE_FILE_KEYS = new Set(["file", "source", "provenance"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeText(text) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a, b) {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (/^\d+$/.test(x) && /^\d+$/.test(y) && x !== y) {
      return Number(x) - Number(y);
    }
    const c = compareStrings(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  return lockPath.slice(lockPath.lastIndexOf(marker) + marker.length);
}

/**
 * Production closure from package-lock.json: every non-dev entry, collapsed
 * to unique name@version. Returns entries sorted by name, then version, each
 * with the lexicographically first install path.
 */
function collectProductionPackages(lockfile) {
  if (lockfile.lockfileVersion !== 3 || !lockfile.packages) {
    throw new Error("package-lock.json must be lockfileVersion 3.");
  }
  const byId = new Map();
  for (const lockPath of Object.keys(lockfile.packages).sort(compareStrings)) {
    const entry = lockfile.packages[lockPath];
    if (lockPath === "" || entry.dev || entry.link) continue;
    const name = entry.name ?? packageNameFromLockPath(lockPath);
    const id = `${name}@${entry.version}`;
    if (!byId.has(id)) {
      byId.set(id, { id, name, version: entry.version, lockPath });
    }
  }
  return [...byId.values()].sort(
    (a, b) => compareStrings(a.name, b.name) || compareVersions(a.version, b.version),
  );
}

function findLicenseFiles(packageDir) {
  return fs
    .readdirSync(packageDir, { withFileTypes: true })
    .filter(
      (dirent) =>
        dirent.isFile() &&
        LICENSE_FILE_PATTERN.test(dirent.name) &&
        !NON_LICENSE_EXTENSIONS.test(dirent.name),
    )
    .map((dirent) => dirent.name)
    .sort(compareStrings);
}

function normalizeRepository(packageJson) {
  let value = packageJson.repository;
  if (value && typeof value === "object") value = value.url;
  if (typeof value === "string" && value.trim() !== "") {
    value = value.trim().replace(/^git\+/, "");
    // npm shorthand: "owner/repo" and "github:owner/repo" mean GitHub.
    const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(value);
    if (shorthand) return `https://github.com/${shorthand[1]}`;
    return value;
  }
  if (typeof packageJson.homepage === "string" && packageJson.homepage.trim() !== "") {
    return packageJson.homepage.trim();
  }
  return null;
}

/**
 * The license expression exactly as the package declares it. SPDX
 * expressions such as "(MPL-2.0 OR Apache-2.0)" are kept as-is; no choice is
 * made between alternatives. The deprecated `licenses` array / object form is
 * accepted only when it names exactly one license.
 */
function declaredLicense(packageJson) {
  if (typeof packageJson.license === "string" && packageJson.license.trim() !== "") {
    return { expression: packageJson.license.trim(), legacy: false };
  }
  const legacy = packageJson.license ?? packageJson.licenses;
  const list = Array.isArray(legacy) ? legacy : legacy ? [legacy] : [];
  if (list.length === 1 && typeof list[0]?.type === "string") {
    return { expression: list[0].type, legacy: true };
  }
  return null;
}

function linesOf(text) {
  return normalizeText(text).split("\n");
}

/**
 * Extracts a verbatim section from a file inside the package: from the line
 * whose trimmed text equals `from` (must occur exactly once) up to, but not
 * including, the line whose trimmed text equals `until`, or to end of file.
 */
function extractExcerpt(packageDir, excerpt, problems, id) {
  const filePath = path.join(packageDir, excerpt.file);
  if (!fs.existsSync(filePath)) {
    problems.push(`${id}: override excerpt file "${excerpt.file}" does not exist.`);
    return null;
  }
  const lines = linesOf(fs.readFileSync(filePath, "utf8"));
  const starts = lines.flatMap((line, i) => (line.trim() === excerpt.from ? [i] : []));
  if (starts.length !== 1) {
    problems.push(
      `${id}: override excerpt start "${excerpt.from}" found ${starts.length} times in ${excerpt.file} (expected 1).`,
    );
    return null;
  }
  let end = lines.length;
  if (excerpt.until !== undefined) {
    end = lines.findIndex((line, i) => i > starts[0] && line.trim() === excerpt.until);
    if (end === -1) {
      problems.push(`${id}: override excerpt end "${excerpt.until}" not found in ${excerpt.file}.`);
      return null;
    }
  }
  return {
    title: `${excerpt.file} (excerpt)`,
    text: normalizeText(lines.slice(starts[0], end).join("\n")),
  };
}

/** File-name prefix that ties a stored upstream license file to name@version. */
function upstreamLicenseFilePrefix(id) {
  return `${id.replace(/\//g, "+")}.`;
}

/**
 * Reads an upstream license file stored verbatim in scripts/thirdPartyLicenses/
 * for a package whose published tarball ships no license text. The file name
 * must start with the package's name@version, and the override must record
 * where the text was taken from.
 */
function readUpstreamLicenseFile(rootDir, id, upstream, problems, usedUpstreamFiles) {
  for (const key of Object.keys(upstream)) {
    if (!UPSTREAM_LICENSE_FILE_KEYS.has(key)) problems.push(`${id}: unknown upstreamLicenseFiles key "${key}".`);
  }
  const prefix = upstreamLicenseFilePrefix(id);
  if (typeof upstream.file !== "string" || !upstream.file.startsWith(prefix) || upstream.file.includes("/")) {
    problems.push(`${id}: upstream license file name must start with "${prefix}".`);
    return null;
  }
  if (typeof upstream.source !== "string" || !upstream.source.startsWith("https://")) {
    problems.push(`${id}: upstream license file "${upstream.file}" needs an https "source".`);
    return null;
  }
  if (typeof upstream.provenance !== "string" || upstream.provenance.trim() === "") {
    problems.push(`${id}: upstream license file "${upstream.file}" needs a "provenance".`);
    return null;
  }
  const filePath = path.join(rootDir, UPSTREAM_LICENSE_DIR, upstream.file);
  if (!fs.existsSync(filePath)) {
    problems.push(`${id}: upstream license file ${UPSTREAM_LICENSE_DIR}/${upstream.file} does not exist.`);
    return null;
  }
  usedUpstreamFiles.add(upstream.file);
  return {
    text: {
      title: `${upstream.file.slice(prefix.length)} (upstream, not in the published package)`,
      text: normalizeText(fs.readFileSync(filePath, "utf8")),
    },
    note: `The published package ships no license file; the upstream license text is reproduced from <${upstream.source}> (${upstream.provenance}).`,
  };
}

function validateOverrideShape(id, override, problems) {
  for (const key of Object.keys(override)) {
    if (!OVERRIDE_KEYS.has(key)) problems.push(`${id}: unknown override key "${key}".`);
  }
  if (typeof override.reason !== "string" || override.reason.trim() === "") {
    problems.push(`${id}: override must state a "reason".`);
  }
}

function resolvePackage(rootDir, pkg, override, problems, usedUpstreamFiles) {
  const packageDir = path.join(rootDir, pkg.lockPath);
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    problems.push(`${pkg.id}: not installed at ${pkg.lockPath} (run npm ci).`);
    return null;
  }
  const packageJson = readJson(packageJsonPath);
  if (packageJson.version !== pkg.version) {
    problems.push(
      `${pkg.id}: installed version ${packageJson.version} at ${pkg.lockPath} does not match package-lock.json.`,
    );
    return null;
  }
  if (packageJson.name !== pkg.name) {
    problems.push(`${pkg.id}: installed package name "${packageJson.name}" does not match.`);
    return null;
  }

  const notes = [];
  if (override) {
    validateOverrideShape(pkg.id, override, problems);
    notes.push(...(override.notes ?? []));
  }

  // License expression.
  const declared = declaredLicense(packageJson);
  let license = declared?.expression ?? null;
  if (declared?.legacy) notes.push("License declared via the deprecated package.json `licenses` field.");
  if (override?.license !== undefined) {
    if (declared) {
      problems.push(`${pkg.id}: override "license" is not allowed, the package declares "${declared.expression}".`);
    } else {
      const evidence = override.licenseEvidence;
      const evidencePath = evidence ? path.join(packageDir, evidence.file) : null;
      if (
        !evidence ||
        !fs.existsSync(evidencePath) ||
        !normalizeText(fs.readFileSync(evidencePath, "utf8")).includes(evidence.text)
      ) {
        problems.push(`${pkg.id}: override "license" needs "licenseEvidence" text found in a package file.`);
      } else {
        license = override.license;
        notes.push(
          `package.json declares no license; \`${override.license}\` is taken from ${evidence.file} ("${evidence.text}").`,
        );
      }
    }
  } else if (override?.licenseEvidence !== undefined) {
    problems.push(`${pkg.id}: "licenseEvidence" without "license".`);
  }
  if (!license) problems.push(`${pkg.id}: license metadata missing (add an override with evidence).`);

  // License / notice texts.
  const licenseFiles = findLicenseFiles(packageDir);
  const texts = licenseFiles.map((file) => ({
    title: file,
    text: normalizeText(fs.readFileSync(path.join(packageDir, file), "utf8")),
  }));
  const excerpts = override?.noticeExcerpts ?? [];
  if (excerpts.length > 0 && licenseFiles.length > 0) {
    problems.push(`${pkg.id}: override "noticeExcerpts" is unnecessary, the package has ${licenseFiles.join(", ")}.`);
  }
  for (const excerpt of excerpts) {
    const resolved = extractExcerpt(packageDir, excerpt, problems, pkg.id);
    if (resolved) texts.push(resolved);
  }
  const upstreamFiles = override?.upstreamLicenseFiles ?? [];
  if (upstreamFiles.length > 0 && licenseFiles.length > 0) {
    problems.push(
      `${pkg.id}: override "upstreamLicenseFiles" is unnecessary, the package has ${licenseFiles.join(", ")}.`,
    );
  }
  for (const upstream of upstreamFiles) {
    const resolved = readUpstreamLicenseFile(rootDir, pkg.id, upstream, problems, usedUpstreamFiles);
    if (resolved) {
      texts.push(resolved.text);
      notes.push(resolved.note);
    }
  }
  if (override?.noLicenseText !== undefined) {
    if (texts.length > 0) {
      problems.push(`${pkg.id}: override "noLicenseText" is unnecessary, license text was found.`);
    } else {
      notes.push(`No license text is shipped in this package: ${override.noLicenseText}`);
    }
  } else if (texts.length === 0) {
    problems.push(`${pkg.id}: no license text found (add an override).`);
  }

  return {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    license,
    repository: normalizeRepository(packageJson),
    notes,
    texts,
  };
}

/**
 * Resolves every production package (plus `additionalPackages` from the
 * overrides, i.e. Electron) into a fully described inventory. Throws one error
 * listing every problem, so nothing is silently skipped.
 */
function buildThirdPartyLicenseInventory({ rootDir, lockfile, overrides }) {
  const problems = [];
  const packageOverrides = overrides.packages ?? {};
  const production = collectProductionPackages(lockfile);
  const productionIds = new Set(production.map((pkg) => pkg.id));

  for (const id of Object.keys(packageOverrides).sort(compareStrings)) {
    if (!productionIds.has(id)) problems.push(`${id}: override does not match any production package (unused).`);
  }

  const usedUpstreamFiles = new Set();
  const packages = production.map((pkg) =>
    resolvePackage(rootDir, pkg, packageOverrides[pkg.id], problems, usedUpstreamFiles),
  );

  const runtimes = [];
  for (const [name, config] of Object.entries(overrides.additionalPackages ?? {}).sort(([a], [b]) =>
    compareStrings(a, b),
  )) {
    const lockPath = `node_modules/${name}`;
    const entry = lockfile.packages[lockPath];
    if (!entry) {
      problems.push(`${name}: additional package is not in package-lock.json (unused).`);
      continue;
    }
    if (productionIds.has(`${name}@${entry.version}`)) {
      problems.push(`${name}: additional package is already a production dependency.`);
      continue;
    }
    const pkg = { id: `${name}@${entry.version}`, name, version: entry.version, lockPath };
    runtimes.push(resolvePackage(rootDir, pkg, config, problems, usedUpstreamFiles));
  }

  const upstreamDir = path.join(rootDir, UPSTREAM_LICENSE_DIR);
  const storedUpstreamFiles = fs.existsSync(upstreamDir) ? fs.readdirSync(upstreamDir).sort(compareStrings) : [];
  for (const file of storedUpstreamFiles) {
    if (!usedUpstreamFiles.has(file)) {
      problems.push(`${UPSTREAM_LICENSE_DIR}/${file}: not referenced by any override (unused).`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Third-party license generation failed:\n- ${problems.join("\n- ")}`);
  }
  return { packages, runtimes };
}

function fenceFor(text) {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function renderPackage(pkg, headingLevel) {
  const heading = "#".repeat(headingLevel);
  const lines = [`${heading} ${pkg.name}@${pkg.version}`, "", `- License: \`${pkg.license}\``];
  if (pkg.repository) lines.push(`- Repository: <${pkg.repository}>`);
  for (const note of pkg.notes) lines.push(`- Note: ${note}`);
  for (const { title, text } of pkg.texts) {
    const fence = fenceFor(text);
    lines.push("", `${heading}# ${title}`, "", `${fence}text`, text, fence);
  }
  return lines.join("\n");
}

function renderThirdPartyLicensesMarkdown({ packages, runtimes }) {
  const out = [
    "# Third-Party Licenses",
    "",
    "<!-- Generated by scripts/generateThirdPartyLicenses.js from package-lock.json and node_modules. Do not edit by hand; run `npm run generate:third-party-licenses`. -->",
    "",
    "This file lists the third-party npm packages distributed with Pergamum",
    "(the production dependency closure in `package-lock.json`) together with",
    "their declared license and the license and notice files they ship. License",
    "texts are copied verbatim from each package; only line endings and trailing",
    "whitespace are normalized. License expressions are reproduced as declared by",
    "each package.",
    "",
    "Third-party assets that are not npm packages (icons, sounds, character data,",
    "fonts with their own license) and additional attributions are listed in",
    "`THIRD_PARTY_NOTICES.md`.",
    "",
    "## Electron runtime",
    "",
    "Pergamum runs on Electron. The Electron license is reproduced below. The",
    "licenses of the components bundled inside Electron (Chromium, Node.js, V8",
    "and others) are provided by Electron itself in `LICENSES.chromium.html`,",
    "distributed next to the Pergamum executable.",
  ];
  for (const runtime of runtimes) out.push("", renderPackage(runtime, 3));

  out.push("", "## Package index", "", `${packages.length} packages.`, "", "| Package | Version | License |", "| --- | --- | --- |");
  for (const pkg of packages) out.push(`| ${pkg.name} | ${pkg.version} | \`${pkg.license}\` |`);

  out.push("", "## Package licenses");
  for (const pkg of packages) out.push("", renderPackage(pkg, 3));
  return `${out.join("\n")}\n`;
}

function generateThirdPartyLicenses(rootDir) {
  const inventory = buildThirdPartyLicenseInventory({
    rootDir,
    lockfile: readJson(path.join(rootDir, "package-lock.json")),
    overrides: readJson(path.join(rootDir, OVERRIDES_RELATIVE_PATH)),
  });
  return { inventory, markdown: renderThirdPartyLicensesMarkdown(inventory) };
}

function main(argv) {
  const rootDir = path.resolve(__dirname, "..");
  const outputPath = path.join(rootDir, OUTPUT_FILE_NAME);
  const { markdown } = generateThirdPartyLicenses(rootDir);
  if (argv.includes("--check")) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== markdown) {
      console.error(`${OUTPUT_FILE_NAME} is out of date. Run: npm run generate:third-party-licenses`);
      process.exitCode = 1;
      return;
    }
    console.log(`${OUTPUT_FILE_NAME} is up to date.`);
    return;
  }
  fs.writeFileSync(outputPath, markdown);
  console.log(`Wrote ${OUTPUT_FILE_NAME}.`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  OUTPUT_FILE_NAME,
  buildThirdPartyLicenseInventory,
  collectProductionPackages,
  findLicenseFiles,
  generateThirdPartyLicenses,
  renderThirdPartyLicensesMarkdown,
};
