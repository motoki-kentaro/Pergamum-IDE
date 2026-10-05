const { flipFuses } = require("@electron/fuses");
const path = require("node:path");
const { pergamumFusePolicy } = require("./electronFusesPolicy");

/**
 * electron-builder afterPack hook to apply the canonical Electron fuse policy
 * to the unpackaged executable (e.g. dist-installer/win-unpacked/Pergamum.exe)
 * before code signing and NSIS installer packaging.
 */
module.exports = async function afterPack(context) {
  const ext = context.electronPlatformName === "win32" ? ".exe" : "";
  const executableName = `${context.packager.appInfo.productFilename}${ext}`;
  const executablePath = path.join(context.appOutDir, executableName);

  await flipFuses(executablePath, pergamumFusePolicy);
};
