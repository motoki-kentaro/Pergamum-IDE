const { FuseV1Options, FuseVersion } = require("@electron/fuses");

/**
 * Canonical Electron fuse hardening policy for Pergamum.
 * Shared between Electron Forge (FusesPlugin) and electron-builder (afterPack hook).
 */
const pergamumFusePolicy = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true
};

module.exports = {
  pergamumFusePolicy
};
