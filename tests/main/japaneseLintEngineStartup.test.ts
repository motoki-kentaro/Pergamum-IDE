import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), isPackaged: false, getVersion: () => "9.9.9" },
  ipcMain: { handle: vi.fn() },
  MessageChannelMain: class {},
  utilityProcess: { fork: () => undefined }
}));

import {
  createInstantJapaneseLintService,
  type InstantJapaneseLintDeps
} from "../../src/main/japaneseLintIpc";
import {
  JapaneseLintWorkerError,
  type JapaneseLintHost,
  type JapaneseLintHostState
} from "../../src/main/linterWorker/japaneseLintHost";
import { formatJapaneseLintEngineTechnicalInfo } from "../../src/shared/japaneseLintEngineTechnicalInfo";

/** #778: a Host whose start() outcomes are scripted (no Worker, no OS). */
function scriptedHost(startResults: (Error | "ok")[]) {
  let state: JapaneseLintHostState = "idle";
  const start = vi.fn(async () => {
    const next = startResults.shift() ?? "ok";

    if (next === "ok") {
      state = "ready";

      return;
    }

    state = "failed";
    throw next;
  });
  const host = {
    getState: () => state,
    createJobId: () => "job",
    start,
    updateConfig: vi.fn(async () => undefined),
    lintDocument: vi.fn(async () => ({
      ok: true as const,
      messages: [],
      totalMessages: 0,
      maxMessages: 1000,
      truncated: false,
      elapsedMs: 1,
      sourceChars: 1,
      sourceLines: 1
    })),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  } as unknown as JapaneseLintHost;

  return { host, start };
}

const request = { text: "秘密の本文です。", format: "text", ext: ".txt" } as const;
const failure = () => new JapaneseLintWorkerError("start-failed");
const dictionaryMissing = () =>
  new JapaneseLintWorkerError("worker-error", {
    kind: "dictionary-missing",
    name: "Error",
    stack: []
  });

function setup(
  hosts: ReturnType<typeof scriptedHost>[],
  settings: unknown = undefined
) {
  let created = 0;
  const deps: InstantJapaneseLintDeps = {
    createHost: () => hosts[Math.min(created++, hosts.length - 1)]!.host,
    settingsProvider: async () => settings,
    logger: { log: () => undefined },
    getEnvironment: () => ({ appVersion: "9.9.9", platform: "win32" })
  };

  return createInstantJapaneseLintService(deps);
}

describe("instant lint engine start sequence (#778)", () => {
  it("first successful start reports 'started' once; later lints carry no notice", async () => {
    const service = setup([scriptedHost(["ok"])]);
    const first = await service.lint(request);
    const second = await service.lint(request);
    const third = await service.lint(request);

    expect(first).toMatchObject({ ok: true, engineNotice: "started" });
    expect(second).not.toHaveProperty("engineNotice");
    expect(third).not.toHaveProperty("engineNotice");
  });

  it("a start that needed retries reports 'restarted' once, and retries without notices", async () => {
    const world = scriptedHost([failure(), "ok"]);
    const service = setup([world]);
    const first = await service.lint(request);
    const second = await service.lint(request);

    expect(world.start).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ ok: true, engineNotice: "restarted" });
    expect(second).not.toHaveProperty("engineNotice");
  });

  it.each([2, 3, 5])(
    "uses workerRestartAttempts=%i: 1 + N start attempts, then engine-unavailable",
    async (restarts) => {
      const world = scriptedHost(
        Array.from({ length: 20 }, () => failure())
      );
      const service = setup([world], {
        workerRestartAttempts: restarts
      });
      const response = await service.lint(request);

      expect(world.start).toHaveBeenCalledTimes(1 + restarts);
      expect(response).toMatchObject({ ok: false, reason: "engine-unavailable" });
      expect((response as { technicalInfo: string }).technicalInfo).toContain(
        `Start Attempts: ${1 + restarts}`
      );
      expect((response as { technicalInfo: string }).technicalInfo).toContain(
        `JapaneseLinter.workerRestartAttempts: ${restarts}`
      );
    }
  );

  it("exhaustion falls back to the default (3) when no setting is stored: 4 attempts", async () => {
    const world = scriptedHost(Array.from({ length: 20 }, () => failure()));
    const service = setup([world]);

    await service.lint(request);
    expect(world.start).toHaveBeenCalledTimes(4);
  });

  it("dictionary-missing leaves at once (#775): no retry, no engine-unavailable", async () => {
    const world = scriptedHost([dictionaryMissing(), "ok"]);
    const service = setup([world]);
    const response = await service.lint(request);

    expect(world.start).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ ok: false, reason: "dictionary-missing" });
  });

  it("OFF -> ON is a new sequence and announces the start again", async () => {
    const worlds = [scriptedHost(["ok"]), scriptedHost(["ok"])];
    const service = setup(worlds);

    expect(await service.lint(request)).toMatchObject({ engineNotice: "started" });
    await service.release();
    expect(await service.lint(request)).toMatchObject({ engineNotice: "started" });
  });

  it("a successful start also needs no notice from concurrent lints (one sequence)", async () => {
    const world = scriptedHost([failure(), "ok"]);
    const service = setup([world]);
    const [a, b] = await Promise.all([service.lint(request), service.lint(request)]);
    const notices = [a, b].filter((r) => r.ok && r.engineNotice !== undefined);

    expect(world.start).toHaveBeenCalledTimes(2);
    expect(notices).toHaveLength(1);
  });
});

describe("engine technical information (#778)", () => {
  it("contains the diagnostic facts and nothing about the manuscript", async () => {
    const world = scriptedHost(Array.from({ length: 6 }, () => failure()));
    const service = setup([world]);
    const response = await service.lint({
      text: "秘密の本文です。",
      format: "markdown",
      ext: ".md"
    });
    const info = (response as { technicalInfo: string }).technicalInfo;

    expect(info).toContain("App Version: 9.9.9");
    expect(info).toContain("Platform: win32");
    expect(info).toContain("Engine State: failed");
    expect(info).toContain("Last Failure: start-failed");
    expect(info).not.toContain("秘密");
    expect(info).not.toMatch(/[A-Za-z]:\|\/Users\/|\/home\//);
  });

  it("includes exit information when available and never other free text", () => {
    const info = formatJapaneseLintEngineTechnicalInfo({
      appVersion: "1.0.0",
      platform: "linux",
      engineState: "failed",
      attempts: 4,
      workerRestartAttempts: 3,
      lastFailureKind: "worker-exited",
      exitCode: 1,
      exitSignal: "SIGSEGV"
    });

    expect(info).toContain("Worker Exit Code: 1");
    expect(info).toContain("Worker Exit Signal: SIGSEGV");
    expect(info.split("\n")).toHaveLength(9);
  });
});
