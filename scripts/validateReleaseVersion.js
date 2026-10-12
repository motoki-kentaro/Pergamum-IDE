#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function validateReleaseVersion(tagName, repoRoot = process.cwd()) {
  if (!tagName || typeof tagName !== 'string' || !tagName.trim()) {
    throw new Error('Tag name is required for version validation.');
  }

  const normalizedTag = tagName.trim();

  // 1. Tag format check: must strictly match ^v[0-9]+\.[0-9]+\.[0-9]+$
  const tagRegex = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
  if (!tagRegex.test(normalizedTag)) {
    throw new Error(
      `Tag '${normalizedTag}' does not match expected semver pattern '^v[0-9]+\\.[0-9]+\\.[0-9]+$' (e.g. v0.90.3).`
    );
  }

  const expectedVersion = normalizedTag.slice(1);

  // 2. package.json check
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at '${pkgPath}'.`);
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package.json: ${err.message}`);
  }

  if (pkg.version !== expectedVersion) {
    throw new Error(
      `Version mismatch: package.json has version '${pkg.version}', but tag '${normalizedTag}' expects '${expectedVersion}'.`
    );
  }

  // 3. package-lock.json check (strictly required)
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(
      `package-lock.json not found at '${lockPath}'. package-lock.json is required.`
    );
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package-lock.json: ${err.message}`);
  }

  if (lock.version !== expectedVersion) {
    throw new Error(
      `Version mismatch: package-lock.json top-level has version '${lock.version}', but tag '${normalizedTag}' expects '${expectedVersion}'.`
    );
  }

  const rootPackage = lock.packages && lock.packages[''];
  if (!rootPackage || typeof rootPackage !== 'object') {
    throw new Error(
      `package-lock.json is missing 'packages[""]' entry for the root package.`
    );
  }

  if (rootPackage.version !== expectedVersion) {
    throw new Error(
      `Version mismatch: package-lock.json packages[""].version is '${rootPackage.version}', but tag '${normalizedTag}' expects '${expectedVersion}'.`
    );
  }

  return {
    valid: true,
    version: expectedVersion,
    tagName: normalizedTag,
  };
}

if (require.main === module) {
  const tagName = process.env.TAG_NAME || process.env.TAG || process.argv[2];
  try {
    const result = validateReleaseVersion(tagName);
    console.log(
      `[validateReleaseVersion] Version validation passed for tag '${result.tagName}' (version: ${result.version}).`
    );
  } catch (err) {
    console.error(`[validateReleaseVersion] ERROR: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  validateReleaseVersion,
};
