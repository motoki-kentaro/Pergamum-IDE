/**
 * Smoke check for a packaged Pergamum build (#776). Not part of `npm test`:
 * run it explicitly after `npm run build:installer` / `npm run build`.
 *
 *   node scripts/verifyPackagedKuromojiDict.js [packagedAppDir]
 *
 * packagedAppDir defaults to dist-installer/win-unpacked (electron-builder);
 * the Forge output is out/Pergamum-win32-x64.
 *
 * 1. kuromoji's dictionary exists in resources/app.asar.unpacked.
 * 2. The packaged Linter Worker (resources/app.asar) loads that dictionary and
 *    reports no-doubled-joshi for .md / .markdown / .txt. The Worker needs an
 *    Electron utilityProcess, so step 2 re-runs this file under the repo's
 *    Electron binary (the packaged exe is fused against that).
 */
const fs = require("node:fs");
const path = require("node:path");

const sample = "私は彼は好きだ。";
const cases = [
  { format: "markdown", ext: ".md" },
  { format: "markdown", ext: ".markdown" },
  { format: "text", ext: ".txt" }
];
const dictionaryFiles = [
  "base.dat.gz", "cc.dat.gz", "check.dat.gz", "tid.dat.gz", "tid_map.dat.gz",
  "tid_pos.dat.gz", "unk.dat.gz", "unk_char.dat.gz", "unk_compat.dat.gz",
  "unk_invoke.dat.gz", "unk_map.dat.gz", "unk_pos.dat.gz"
];

function paths(appDir) {
  const resources = path.join(appDir, "resources");

  return {
    dictionary: path.join(resources, "app.asar.unpacked", "node_modules", "kuromoji", "dict"),
    worker: path.join(resources, "app.asar", ".vite", "build", "japaneseLintWorker.cjs")
  };
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function runInElectron(appDir) {
  const { app, utilityProcess, MessageChannelMain } = require("electron");
  const { dictionary, worker } = paths(appDir);
  const config = {
    enabledRuleIds: ["no-doubled-joshi"],
    rules: [{ id: "no-doubled-joshi", options: {} }],
    debounceMs: 0,
    lineCacheLimit: 100,
    workerRestartAttempts: 0
  };
  const finish = (code, message) => {
    console.log(message);
    app.exit(code);
  };

  app.whenReady().then(() => {
    const child = utilityProcess.fork(worker);
    const { port1, port2 } = new MessageChannelMain();
    const pending = cases.slice();
    const timer = setTimeout(() => finish(1, "FAIL: Worker timed out"), 60000);

    port1.on("message", ({ data }) => {
      if (data.type === "error") {
        finish(1, `FAIL: Worker error ${JSON.stringify(data.error)}`);
      } else if (data.type === "ready") {
        sendNext();
      } else if (data.type === "lint-result") {
        const hit = data.result.messages.some((m) => m.ruleId === "no-doubled-joshi");
        const current = pending.shift();

        console.log(`${current.ext}: ${hit ? "OK" : "FAIL"} (${data.result.totalMessages} message(s))`);
        if (!hit) {
          return finish(1, "FAIL: no-doubled-joshi was not reported");
        }
        pending.length > 0 ? sendNext() : (clearTimeout(timer), finish(0, "PASS: packaged Worker lints with the packaged dictionary"));
      }
    });
    port1.start();

    function sendNext() {
      const { format, ext } = pending[0];

      port1.postMessage({
        type: "lintDocument", requestId: `r-${ext.slice(1)}`, jobId: `j-${ext.slice(1)}`,
        source: sample, format, ext
      });
    }

    child.postMessage({ type: "connect" }, [port2]);
    port1.postMessage({ type: "init", requestId: "init", dictionaryPath: dictionary, config });
  });
}

if (process.versions.electron) {
  runInElectron(process.env.PERGAMUM_SMOKE_APP_DIR);
} else {
  const appDir = path.resolve(process.argv[2] ?? path.join("dist-installer", "win-unpacked"));
  const { dictionary } = paths(appDir);

  for (const file of dictionaryFiles) {
    if (!fs.existsSync(path.join(dictionary, file))) {
      fail(`missing ${path.join(dictionary, file)}`);
    }
  }
  console.log(`OK: ${dictionaryFiles.length} dictionary files in ${dictionary}`);

  const result = require("node:child_process").spawnSync(
    require("electron"),
    [__filename],
    { stdio: "inherit", env: { ...process.env, PERGAMUM_SMOKE_APP_DIR: appDir } }
  );

  process.exit(result.status ?? 1);
}
