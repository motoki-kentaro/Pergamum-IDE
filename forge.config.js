const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const path = require('node:path');
const { pergamumFusePolicy } = require('./scripts/electronFusesPolicy');

const appIcon = 'assets/icon';
// #627: legal files copied verbatim to <app>/resources/. Pergamum's own
// LICENSE lands at resources/LICENSE, so it never replaces Electron's LICENSE
// and LICENSES.chromium.html at the app root. Keep in sync with
// package.json build.extraResources (electron-builder / NSIS).
const legalFiles = ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_NOTICES.md'];
const packagedExternalDependencies = [
  'node_modules/better-sqlite3',
  'node_modules/bindings',
  'node_modules/file-uri-to-path',
  // #625: kuromoji's dictionary, read from disk at runtime by textlint's
  // Japanese rules (everything else of textlint is bundled by Vite).
  'node_modules/kuromoji/dict',
];

function shouldPackageFile(file) {
  if (!file) {
    return false;
  }

  const normalizedFile = toPackageRelativePath(file);

  if (normalizedFile === '/package.json') {
    return true;
  }

  if (normalizedFile === '/.vite' || normalizedFile.startsWith('/.vite/')) {
    return true;
  }

  if (normalizedFile === '/node_modules') {
    return true;
  }

  return packagedExternalDependencies.some((dependencyPath) => {
    const normalizedDependencyPath = `/${dependencyPath}`;

    return (
      normalizedFile === normalizedDependencyPath ||
      normalizedFile.startsWith(`${normalizedDependencyPath}/`) ||
      // An ancestor directory of a packaged path (e.g. /node_modules/kuromoji
      // for /node_modules/kuromoji/dict) must be visited to reach it.
      normalizedDependencyPath.startsWith(`${normalizedFile}/`)
    );
  });
}

function toPackageRelativePath(file) {
  const normalizedFile = file.replace(/\\/g, '/');

  if (normalizedFile.startsWith('/')) {
    return normalizedFile;
  }

  if (path.isAbsolute(file)) {
    const relativeFile = path.relative(__dirname, file).replace(/\\/g, '/');

    if (!relativeFile.startsWith('..')) {
      return `/${relativeFile}`;
    }
  }

  return `/${normalizedFile}`;
}

module.exports = {
  packagerConfig: {
    // kuromoji's dictionary is read from disk at runtime by the Japanese
    // Linter (in the Linter Worker utilityProcess), so it ships unpacked at
    // resources/app.asar.unpacked/node_modules/kuromoji/dict (#625).
    // AutoUnpackNatives merges its own pattern into this one.
    asar: { unpack: '**/node_modules/kuromoji/dict/**' },
    icon: appIcon,
    extraResource: legalFiles,
    ignore: (file) => (file ? !shouldPackageFile(file) : false),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupIcon: 'assets/icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main/main.ts',
            config: 'vite.main.config.mts',
            target: 'main',
          },
          {
            // #625: the Japanese Linter Worker, run by utilityProcess.fork().
            // Its own bundle next to main.cjs (.vite/build/japaneseLintWorker.cjs).
            entry: 'src/main/linterWorker/japaneseLintWorker.ts',
            config: 'vite.main.config.mts',
            target: 'main',
          },
          {
            entry: 'src/preload/preload.ts',
            config: 'vite.preload.config.mts',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mts',
          },
        ],
      },
    },
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin(pergamumFusePolicy),
  ],
};
