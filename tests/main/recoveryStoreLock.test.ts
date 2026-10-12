import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseRecoveryStoreOwnerInfo,
  recoveryStoreLockDirectoryName,
  recoveryStoreLockOwnerFileName,
  type RecoveryStoreOwnerInfo
} from "../../src/shared/recovery";
import {
  createRecoveryStoreLock,
  type RecoveryStoreLockFileSystem,
  type RecoveryStoreLockStaleReclamationPolicy
} from "../../src/main/recoveryStoreLock";
import type { ProcessLiveness } from "../../src/main/processLiveness";

let workDir = "";

function lockDirectoryPath(): string {
  return path.join(workDir, recoveryStoreLockDirectoryName);
}

function ownerFilePath(): string {
  return path.join(lockDirectoryPath(), recoveryStoreLockOwnerFileName);
}

function ownerInfo(
  overrides: Partial<RecoveryStoreOwnerInfo> = {}
): RecoveryStoreOwnerInfo {
  return {
    instanceRunId: "0198d95f-97d8-7000-8000-000000000238",
    pid: 4242,
    createdAt: new Date("2026-08-29T08:21:00.000Z").toISOString(),
    appVersion: "9.8.7-test",
    ...overrides
  };
}

/** A real-`node:fs`-backed seam; individual methods can be overridden. */
function realSeam(
  overrides: Partial<RecoveryStoreLockFileSystem> = {}
): RecoveryStoreLockFileSystem {
  return {
    mkdir: (dirPath) => fs.mkdir(dirPath).then(() => undefined),
    writeFile: (filePath, data, options) =>
      fs.writeFile(filePath, data, options),
    rm: (filePath, options) => fs.rm(filePath, options),
    rmdir: (dirPath) => fs.rmdir(dirPath),
    readFile: (filePath) => fs.readFile(filePath, "utf8"),
    rename: (fromPath, toPath) =>
      fs.rename(fromPath, toPath).then(() => undefined),
    stat: async (targetPath) => {
      const stats = await fs.stat(targetPath);
      return { isDirectory: () => stats.isDirectory() };
    },
    ...overrides
  };
}

function stalePolicy(
  liveness: ProcessLiveness | ((pid: number) => ProcessLiveness),
  now: () => Date = () => new Date("2026-08-29T10:00:00.000Z")
): { staleReclamation: RecoveryStoreLockStaleReclamationPolicy } {
  return {
    staleReclamation: {
      probeProcessLiveness:
        typeof liveness === "function" ? liveness : () => liveness,
      now
    }
  };
}

async function seedHeldLock(owner: RecoveryStoreOwnerInfo): Promise<void> {
  await fs.mkdir(lockDirectoryPath());
  await fs.writeFile(
    ownerFilePath(),
    `${JSON.stringify(owner, null, 2)}\n`,
    "utf8"
  );
}

async function listStaleArchives(): Promise<string[]> {
  const entries = await fs.readdir(workDir);
  return entries.filter((name) =>
    name.startsWith(`${recoveryStoreLockDirectoryName}.stale-`)
  );
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pergamum-recovery-lock-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("createRecoveryStoreLock — plain acquire (Phase 6-4-2)", () => {
  it("acquires by creating the lock directory and stamping owner.json", async () => {
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    await expect(lock.acquire(ownerInfo())).resolves.toEqual({
      outcome: "acquired"
    });
    expect(lock.isHeld()).toBe(true);

    const stat = await fs.stat(lockDirectoryPath());
    expect(stat.isDirectory()).toBe(true);

    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).toEqual(ownerInfo());
  });

  it("a second lock over the same directory is unavailable and leaves the holder's marker intact", async () => {
    const firstOwner = ownerInfo();
    const first = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });
    await first.acquire(firstOwner);

    const second = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    // Feature off (no staleReclamation): any EEXIST ⇒ unavailable.
    await expect(
      second.acquire(
        ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-000000000999" })
      )
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(second.isHeld()).toBe(false);

    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).toEqual(firstOwner);
    expect(await listStaleArchives()).toEqual([]);
  });

  it("does not wait or retry when the lock is held (immediate non-owner)", async () => {
    const first = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });
    await first.acquire(ownerInfo());

    const second = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    const startedAt = Date.now();
    await expect(second.acquire(ownerInfo())).resolves.toEqual({
      outcome: "unavailable"
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("release deletes owner.json and the lock directory", async () => {
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });
    await lock.acquire(ownerInfo());

    await expect(lock.release()).resolves.toBe("released");
    expect(lock.isHeld()).toBe(false);
    await expect(fs.access(lockDirectoryPath())).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("release before acquire reports notHeld and never touches the filesystem", async () => {
    await fs.mkdir(lockDirectoryPath());
    await fs.writeFile(ownerFilePath(), "held by someone else\n", "utf8");

    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    await expect(lock.release()).resolves.toBe("notHeld");
    await expect(fs.access(lockDirectoryPath())).resolves.toBeUndefined();
  });

  it("rolls back its own directory when the owner.json write fails", async () => {
    const rmdirCalls: string[] = [];
    const faultyFs = realSeam({
      writeFile: () => Promise.reject(new Error("marker write boom")),
      rmdir: (dirPath) => {
        rmdirCalls.push(dirPath);
        return fs.rmdir(dirPath);
      }
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    await expect(lock.acquire(ownerInfo())).resolves.toEqual({
      outcome: "unavailable"
    });
    expect(lock.isHeld()).toBe(false);
    expect(rmdirCalls).toEqual([lockDirectoryPath()]);
    await expect(fs.access(lockDirectoryPath())).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("createRecoveryStoreLock — stale-lock reclamation (#293)", () => {
  it("no lock present: plain acquire, no stale takeover, no archive", async () => {
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("dead"));

    expect(result).toEqual({ outcome: "acquired" });
    expect(await listStaleArchives()).toEqual([]);
  });

  it("feature off + EEXIST: unavailable, pre-#293 behavior", async () => {
    await seedHeldLock(ownerInfo({ pid: 999 }));
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    await expect(lock.acquire(ownerInfo())).resolves.toEqual({
      outcome: "unavailable"
    });
    expect(await listStaleArchives()).toEqual([]);
  });

  it("owner probes alive: unavailable, no archive, marker intact", async () => {
    const staleOwner = ownerInfo({
      pid: 999,
      instanceRunId: "0198d95f-97d8-7000-8000-0000000000ff"
    });
    await seedHeldLock(staleOwner);
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("alive"));

    expect(result).toEqual({
      outcome: "unavailable",
      staleTakeover: {
        phase: "refused",
        ownerPid: 999,
        ownerAppVersion: "9.8.7-test",
        ownerCreatedAt: staleOwner.createdAt
      }
    });
    expect(await listStaleArchives()).toEqual([]);
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).toEqual(staleOwner);
  });

  it("owner liveness unknown: unavailable, no archive", async () => {
    await seedHeldLock(ownerInfo({ pid: 999 }));
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("unknown"));

    expect(result.outcome).toBe("unavailable");
    expect(result.staleTakeover?.phase).toBe("refused");
    expect(await listStaleArchives()).toEqual([]);
  });

  it("missing owner.json (marker-less dir): unavailable, no archive", async () => {
    await fs.mkdir(lockDirectoryPath());
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    await expect(
      lock.acquire(ownerInfo(), stalePolicy("dead"))
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(await listStaleArchives()).toEqual([]);
  });

  it("malformed owner.json: unavailable, no archive", async () => {
    await fs.mkdir(lockDirectoryPath());
    await fs.writeFile(ownerFilePath(), "{ not json", "utf8");
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    await expect(
      lock.acquire(ownerInfo(), stalePolicy("dead"))
    ).resolves.toEqual({ outcome: "unavailable" });

    await fs.writeFile(
      ownerFilePath(),
      JSON.stringify({ pid: "x", instanceRunId: "not-a-uuid" }),
      "utf8"
    );
    await expect(
      lock.acquire(ownerInfo(), stalePolicy("dead"))
    ).resolves.toEqual({ outcome: "unavailable" });

    expect(await listStaleArchives()).toEqual([]);
  });

  it("dead owner: archives the stale lock, reacquires, writes a fresh owner.json", async () => {
    const staleOwner = ownerInfo({
      pid: 62368,
      instanceRunId: "0198d95f-97d8-7000-8000-0000000000ff",
      appVersion: "0.60.0",
      createdAt: new Date("2026-08-29T08:06:16.724Z").toISOString()
    });
    await seedHeldLock(staleOwner);

    const takingOver = ownerInfo({
      pid: 4242,
      instanceRunId: "0198d95f-97d8-7000-8000-000000000238"
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath()
    });

    const result = await lock.acquire(takingOver, stalePolicy("dead"));

    expect(result).toEqual({
      outcome: "acquired",
      staleTakeover: {
        phase: "reacquired",
        ownerPid: 62368,
        ownerAppVersion: "0.60.0",
        ownerCreatedAt: staleOwner.createdAt,
        archivedLockDirName: expect.stringMatching(
          /^Recovery\.lock\.stale-.+-[0-9a-f]{8}$/
        )
      }
    });
    expect(lock.isHeld()).toBe(true);

    // The live lock exists again, now stamped with the taking-over process.
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).toEqual(takingOver);

    // Exactly one archive dir, holding the dead owner's marker verbatim.
    const archives = await listStaleArchives();
    expect(archives).toHaveLength(1);
    const archivedRaw = await fs.readFile(
      path.join(workDir, archives[0], recoveryStoreLockOwnerFileName),
      "utf8"
    );
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(archivedRaw))).toEqual(
      staleOwner
    );
  });

  it("archive rename fails: unavailable, original lock untouched", async () => {
    const staleOwner = ownerInfo({ pid: 999 });
    await seedHeldLock(staleOwner);

    const faultyFs = realSeam({
      rename: () => Promise.reject(new Error("rename boom"))
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("dead"));

    expect(result.outcome).toBe("unavailable");
    expect(result.staleTakeover?.phase).toBe("archiveFailed");
    expect(lock.isHeld()).toBe(false);
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).toEqual(staleOwner);
    expect(await listStaleArchives()).toEqual([]);
  });

  it("reacquire mkdir fails after archive: unavailable, no loop", async () => {
    await seedHeldLock(ownerInfo({ pid: 999 }));

    let mkdirCalls = 0;
    const faultyFs = realSeam({
      mkdir: (dirPath) => {
        mkdirCalls += 1;
        return mkdirCalls >= 2
          ? Promise.reject(new Error("mkdir boom"))
          : fs.mkdir(dirPath).then(() => undefined);
      }
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("dead"));

    expect(result.outcome).toBe("unavailable");
    expect(result.staleTakeover?.phase).toBe("reacquireFailed");
    // Exactly one archive, exactly two mkdir attempts — no retry loop.
    expect(mkdirCalls).toBe(2);
    expect(await listStaleArchives()).toHaveLength(1);
    await expect(fs.access(lockDirectoryPath())).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("TOCTOU re-read mismatch: unavailable, never renames", async () => {
    const first = ownerInfo({
      pid: 999,
      instanceRunId: "0198d95f-97d8-7000-8000-00000000aaaa"
    });
    const second = ownerInfo({
      pid: 1000,
      instanceRunId: "0198d95f-97d8-7000-8000-00000000bbbb"
    });
    await seedHeldLock(first);

    let reads = 0;
    const renameSpy = vi.fn(() => Promise.resolve());
    const faultyFs = realSeam({
      readFile: () => {
        reads += 1;
        return Promise.resolve(
          `${JSON.stringify(reads === 1 ? first : second, null, 2)}\n`
        );
      },
      rename: renameSpy
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    await expect(
      lock.acquire(ownerInfo(), stalePolicy("dead"))
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(renameSpy).not.toHaveBeenCalled();
    expect(await listStaleArchives()).toEqual([]);
  });

  it("holder released during the EEXIST window: clean acquire, no stale takeover", async () => {
    // EEXIST from mkdir, then the dir is gone by the time we stat it.
    let mkdirCalls = 0;
    const faultyFs = realSeam({
      mkdir: (dirPath) => {
        mkdirCalls += 1;
        if (mkdirCalls === 1) {
          const error = Object.assign(new Error("exists"), { code: "EEXIST" });
          return Promise.reject(error);
        }
        return fs.mkdir(dirPath).then(() => undefined);
      },
      stat: () =>
        Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" }))
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("dead"));

    expect(result).toEqual({ outcome: "acquired" });
    expect(lock.isHeld()).toBe(true);
    expect(await listStaleArchives()).toEqual([]);
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).toEqual(ownerInfo());
  });

  it("Recovery.lock is a file, not a directory: unavailable, file not renamed", async () => {
    await fs.writeFile(lockDirectoryPath(), "not a directory", "utf8");
    const renameSpy = vi.fn(() => Promise.resolve());
    const faultyFs = realSeam({ rename: renameSpy });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    await expect(
      lock.acquire(ownerInfo(), stalePolicy("dead"))
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(renameSpy).not.toHaveBeenCalled();
    expect(await fs.readFile(lockDirectoryPath(), "utf8")).toBe(
      "not a directory"
    );
  });

  it("fresh owner.json self-check fails: refuses safely, does not claim ownership", async () => {
    await seedHeldLock(ownerInfo({ pid: 999 }));

    const impostor = ownerInfo({
      pid: 5,
      instanceRunId: "0198d95f-97d8-7000-8000-00000000cccc"
    });
    let writes = 0;
    const faultyFs = realSeam({
      writeFile: async (filePath, data, options) => {
        writes += 1;
        // Let the write land, but make the read-back look like someone else.
        await fs.writeFile(filePath, data, options);
      },
      readFile: async (filePath) => {
        const real = await fs.readFile(filePath, "utf8");
        // After our fresh write, pretend a different run owns it.
        return writes > 0
          ? `${JSON.stringify(impostor, null, 2)}\n`
          : real;
      }
    });
    const lock = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: faultyFs
    });

    const result = await lock.acquire(ownerInfo(), stalePolicy("dead"));

    expect(result.outcome).toBe("unavailable");
    expect(lock.isHeld()).toBe(false);
  });

  it("two contenders over one dead owner: at most one becomes owner, and recovery remains cleanly acquirable (#293)", async () => {
    // PO Specification Decision:
    // Under simultaneous race contention over a dead owner without complex consensus
    // algorithms, the core safety invariant is that AT MOST ONE contender can become
    // owner (never multiple writers). If timing causes both contenders to fail-closed
    // cleanly to avoid corruption, subsequent startup must be able to acquire Recovery.
    const staleOwner = ownerInfo({
      pid: 999,
      instanceRunId: "0198d95f-97d8-7000-8000-0000000000ff"
    });
    await seedHeldLock(staleOwner);

    const a = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });
    const b = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });

    const [ra, rb] = await Promise.all([
      a.acquire(
        ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" }),
        stalePolicy("dead", () => new Date("2026-08-29T10:00:00.000Z"))
      ),
      b.acquire(
        ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000b" }),
        stalePolicy("dead", () => new Date("2026-08-29T10:00:01.000Z"))
      )
    ]);

    const acquired = [ra, rb].filter((r) => r.outcome === "acquired");
    // Invariant: at most one process can hold the writing lock
    expect(acquired.length).toBeLessThanOrEqual(1);
    expect([a.isHeld(), b.isHeld()].filter(Boolean).length).toBe(acquired.length);

    if (acquired.length === 1) {
      // If a contender won, its marker is intact and valid
      const raw = await fs.readFile(ownerFilePath(), "utf8");
      expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))).not.toBeNull();
    } else {
      // If both contenders backed off safely to avoid race corruption,
      // verify that subsequent startup can acquire cleanly
      const subsequent = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });
      const nextRes = await subsequent.acquire(
        ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000c" }),
        stalePolicy("dead")
      );
      expect(nextRes.outcome).toBe("acquired");
      expect(subsequent.isHeld()).toBe(true);
      await subsequent.release();
    }
  });

  it("Experiment A: bestEffortCleanupOwnDirectory destroys another contender's newly established live owner.json", async () => {
    function deferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const aMkdirDone = deferred();
    const bAcquiredDone = deferred();
    const aCleanupDone = deferred();

    // Contender A attempts plain acquire:
    // 1. A creates Recovery.lock directory.
    // 2. Before A writes its marker, Contender B discovers Recovery.lock and writes its own marker (or establishes it).
    // Specifically, A's writeOwnerMarker uses { flag: 'wx' }.
    // If B writes owner.json FIRST, then A's writeFile fails naturally with EEXIST!
    // A's writeOwnerMarker catches the error and returns false.
    // Then A runs bestEffortCleanupOwnDirectory() which calls:
    //   fileSystem.rm(ownerFilePath, { force: true })
    // -> A deletes B's valid, live owner.json!
    const fsA = realSeam({
      mkdir: async (dirPath) => {
        const res = await fs.mkdir(dirPath);
        aMkdirDone.resolve();
        // Wait until B has written owner.json and acquired the lock!
        await bAcquiredDone.promise;
        return res;
      },
      rmdir: async (dirPath) => {
        try {
          await fs.rmdir(dirPath);
        } finally {
          aCleanupDone.resolve();
        }
      }
    });

    const a = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: fsA
    });

    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerB = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000b" });

    // Start A's acquire
    const aPromise = a.acquire(ownerA);

    // Wait until A creates the empty directory
    await aMkdirDone.promise;

    // Now B (or another process) writes a live owner.json into that directory
    await fs.writeFile(
      ownerFilePath(),
      `${JSON.stringify(ownerB, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    bAcquiredDone.resolve();

    // A finishes its acquire (fails to write marker due to EEXIST, then calls cleanup)
    const ra = await aPromise;
    await aCleanupDone.promise;

    expect(ra.outcome).toBe("unavailable");

    // SAFETY CHECK: A's cleanup did NOT delete B's live owner.json!
    const ownerExists = await fs.access(ownerFilePath()).then(() => true).catch(() => false);
    expect(ownerExists).toBe(true);
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))?.instanceRunId).toBe(
      ownerB.instanceRunId
    );
  });

  it("Experiment B: natural collision under contention without artificial errors yields at most one owner, and subsequent launch acquires cleanly", async () => {
    function deferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const staleOwner = ownerInfo({
      pid: 999,
      instanceRunId: "0198d95f-97d8-7000-8000-0000000000ff"
    });
    await seedHeldLock(staleOwner);

    const bPassedStep5 = deferred();
    const aMkdirDone = deferred();
    const bRenamedDone = deferred();

    let aRenameCount = 0;
    const fsA = realSeam({
      rename: async (from, to) => {
        await bPassedStep5.promise;
        await fs.rename(from, to);
        aRenameCount += 1;
      },
      mkdir: async (dirPath) => {
        const res = await fs.mkdir(dirPath);
        if (aRenameCount === 1) {
          aMkdirDone.resolve();
          await bRenamedDone.promise;
        }
        return res;
      }
    });

    let bReadCount = 0;
    const fsB = realSeam({
      readFile: async (filePath) => {
        const content = await fs.readFile(filePath, "utf8");
        bReadCount += 1;
        if (bReadCount === 2) {
          bPassedStep5.resolve();
        }
        return content;
      },
      rename: async (from, to) => {
        await aMkdirDone.promise;
        try {
          return await fs.rename(from, to);
        } finally {
          bRenamedDone.resolve();
        }
      }
    });

    const a = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath(), fileSystem: fsA });
    const b = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath(), fileSystem: fsB });

    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerB = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000b" });

    // Different timestamps so archive directory names never collide on Windows
    const policyA = stalePolicy("dead", () => new Date("2026-08-29T10:00:00.000Z"));
    const policyB = stalePolicy("dead", () => new Date("2026-08-29T10:00:01.000Z"));

    const [ra, rb] = await Promise.all([
      a.acquire(ownerA, policyA),
      b.acquire(ownerB, policyB)
    ]);

    const acquired = [ra, rb].filter((r) => r.outcome === "acquired");
    // Under contention, at most one acquires (here 0 due to mutual back-off)
    expect(acquired.length).toBeLessThanOrEqual(1);

    if (a.isHeld()) await a.release();
    if (b.isHeld()) await b.release();

    // Subsequent launch can acquire cleanly!
    const subsequent = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });
    const ownerSubsequent = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000c" });
    const rSubsequent = await subsequent.acquire(ownerSubsequent, stalePolicy("dead"));

    expect(rSubsequent.outcome).toBe("acquired");
    expect(subsequent.isHeld()).toBe(true);

    const activeRaw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(activeRaw))?.instanceRunId).toBe(
      ownerSubsequent.instanceRunId
    );

    await subsequent.release();
  });

  it("Audit A: contender archives another process's directory by mistake and does NOT overwrite third-party directory with restore rename", async () => {
    function deferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const staleOwner = ownerInfo({
      pid: 999,
      instanceRunId: "0198d95f-97d8-7000-8000-0000000000ff"
    });
    await seedHeldLock(staleOwner);

    const aPassedStep5 = deferred();
    const bCreatedDirB = deferred();
    const aRenamedBDone = deferred();
    const cFinishedDone = deferred();

    // Contender A attempts stale reclamation:
    // 1. A reads staleOwner at step 2 and step 5.
    // 2. Before A executes Step 6 rename, B archives staleOwner and creates empty Recovery.lock (dir B).
    // 3. A executes Step 6: renames dir B to archive-A!
    // 4. In the gap before A evaluates Step 6.5, third-party C creates Recovery.lock (dir C) and stamps ownerC!
    // 5. A inspects archive-A: it is empty!
    // 6. With safe code: A does NOT attempt restore rename. A cleans up archive-A (rmdir) and returns unavailable.
    // 7. C's live lock is 100% intact!

    let aReadCount = 0;
    const fsA = realSeam({
      readFile: async (filePath) => {
        const content = await fs.readFile(filePath, "utf8");
        aReadCount += 1;
        if (aReadCount === 2) {
          aPassedStep5.resolve();
          await bCreatedDirB.promise;
        }
        return content;
      },
      rename: async (from, to) => {
        // A renames dir B to archive-A
        const res = await fs.rename(from, to);
        aRenamedBDone.resolve();
        // Pause before Step 6.5 so C can create its lock at lockDirectoryPath
        await cFinishedDone.promise;
        return res;
      }
    });

    const a = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: fsA
    });

    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerC = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000c" });

    // Start A's acquire
    const aPromise = a.acquire(ownerA, stalePolicy("dead"));
    await aPassedStep5.promise;

    // Simulate B archiving staleOwner and creating an empty Recovery.lock (dir B)
    await fs.rename(
      lockDirectoryPath(),
      path.join(workDir, `${recoveryStoreLockDirectoryName}.stale-simulated-b`)
    );
    await fs.mkdir(lockDirectoryPath());
    bCreatedDirB.resolve();

    // Wait until A has renamed dir B to archive-A
    await aRenamedBDone.promise;

    // Now C arrives and creates Recovery.lock (dir C) with ownerC!
    await fs.mkdir(lockDirectoryPath());
    await fs.writeFile(
      ownerFilePath(),
      `${JSON.stringify(ownerC, null, 2)}\n`,
      "utf8"
    );
    cFinishedDone.resolve();

    const ra = await aPromise;
    expect(ra.outcome).toBe("unavailable");

    // C's owner marker must NOT be overwritten or destroyed!
    const activeRaw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(activeRaw))?.instanceRunId).toBe(
      ownerC.instanceRunId
    );
  });

  it("Audit B: cleanup never deletes files; leaves another contender's marker untouched", async () => {
    function deferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const aMkdirDone = deferred();
    const bWriteDone = deferred();
    const rmSpy = vi.fn();

    const fsA = realSeam({
      mkdir: async (dirPath) => {
        const res = await fs.mkdir(dirPath);
        aMkdirDone.resolve();
        await bWriteDone.promise;
        return res;
      },
      rm: async (filePath, options) => {
        rmSpy(filePath);
        return fs.rm(filePath, options);
      }
    });

    const a = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: fsA
    });

    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerB = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000b" });

    const aPromise = a.acquire(ownerA);
    await aMkdirDone.promise;

    // B writes ownerB into the directory
    await fs.writeFile(
      ownerFilePath(),
      `${JSON.stringify(ownerB, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    bWriteDone.resolve();

    const ra = await aPromise;
    expect(ra.outcome).toBe("unavailable");

    // A's cleanup MUST NOT have called rm at all!
    expect(rmSpy).not.toHaveBeenCalled();

    // B's marker is intact!
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))?.instanceRunId).toBe(
      ownerB.instanceRunId
    );
  });

  it("Audit C: release refuses to delete owner.json when marker belongs to another owner", async () => {
    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerB = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000b" });

    const a = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });
    await expect(a.acquire(ownerA)).resolves.toEqual({ outcome: "acquired" });
    expect(a.isHeld()).toBe(true);

    // Simulate external replacement: ownerB replaces the marker
    await fs.writeFile(
      ownerFilePath(),
      `${JSON.stringify(ownerB, null, 2)}\n`,
      "utf8"
    );

    // A calls release()
    const result = await a.release();
    expect(result).toBe("failed");
    expect(a.isHeld()).toBe(false);

    // B's marker is NOT deleted!
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))?.instanceRunId).toBe(
      ownerB.instanceRunId
    );
  });

  it("Audit D: isHeld reflects in-memory state synchronously and does not authorize rogue deletion", async () => {
    const lock = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });
    expect(lock.isHeld()).toBe(false);

    await lock.acquire(ownerInfo());
    expect(lock.isHeld()).toBe(true);

    // A second acquire is a no-op idempotent return
    await expect(lock.acquire(ownerInfo())).resolves.toEqual({ outcome: "acquired" });

    // Release drops isHeld immediately
    await lock.release();
    expect(lock.isHeld()).toBe(false);

    // Calling release again is a no-op notHeld
    await expect(lock.release()).resolves.toBe("notHeld");
  });

  it("Audit E: writeOwnerMarker fails closed immediately on ENOENT without retrying into a replaced directory", async () => {
    function deferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const aMkdirDone = deferred();
    const replacedDone = deferred();
    let writeAttempts = 0;

    const fsA = realSeam({
      mkdir: async (dirPath) => {
        const res = await fs.mkdir(dirPath);
        aMkdirDone.resolve();
        await replacedDone.promise;
        return res;
      },
      writeFile: async (filePath, data, options) => {
        writeAttempts += 1;
        return fs.writeFile(filePath, data, options);
      }
    });

    const a = createRecoveryStoreLock({
      lockDirectoryPath: lockDirectoryPath(),
      fileSystem: fsA
    });

    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerC = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000c" });

    const aPromise = a.acquire(ownerA);
    await aMkdirDone.promise;

    // Simulate directory removal and replacement by C
    await fs.rmdir(lockDirectoryPath());
    await fs.mkdir(lockDirectoryPath());
    await fs.writeFile(
      ownerFilePath(),
      `${JSON.stringify(ownerC, null, 2)}\n`,
      "utf8"
    );
    replacedDone.resolve();

    const ra = await aPromise;
    expect(ra.outcome).toBe("unavailable");

    // Exactly 1 write attempt (fails with EEXIST), ZERO retries!
    expect(writeAttempts).toBe(1);

    // C's marker is intact
    const raw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(raw))?.instanceRunId).toBe(
      ownerC.instanceRunId
    );
  });

  it("when contenders both back off under contention, subsequent launch cleanly acquires recovery (#293 req 5)", async () => {
    const staleOwner = ownerInfo({
      pid: 999,
      instanceRunId: "0198d95f-97d8-7000-8000-0000000000ff"
    });
    await seedHeldLock(staleOwner);

    // Contender A fails marker write (fails closed)
    const fsA = realSeam({
      writeFile: async () => {
        throw new Error("simulated disk full on marker write");
      }
    });

    const a = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath(), fileSystem: fsA });
    const b = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });

    const ownerA = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000a" });
    const ownerB = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000b" });

    // Both contenders attempt to acquire
    const [ra, rb] = await Promise.all([
      a.acquire(ownerA, stalePolicy("dead")),
      b.acquire(ownerB, stalePolicy("dead"))
    ]);

    const acquired = [ra, rb].filter((r) => r.outcome === "acquired");
    expect(acquired.length).toBeLessThanOrEqual(1);

    // If neither acquired (or regardless of race outcome), release any held lock
    if (a.isHeld()) await a.release();
    if (b.isHeld()) await b.release();

    // Requirement 5: Subsequent launch can acquire cleanly!
    const subsequent = createRecoveryStoreLock({ lockDirectoryPath: lockDirectoryPath() });
    const ownerSubsequent = ownerInfo({ instanceRunId: "0198d95f-97d8-7000-8000-00000000000c" });
    const rSubsequent = await subsequent.acquire(ownerSubsequent, stalePolicy("dead"));

    expect(rSubsequent.outcome).toBe("acquired");
    expect(subsequent.isHeld()).toBe(true);

    const activeRaw = await fs.readFile(ownerFilePath(), "utf8");
    expect(parseRecoveryStoreOwnerInfo(JSON.parse(activeRaw))?.instanceRunId).toBe(
      ownerSubsequent.instanceRunId
    );

    await subsequent.release();
  });
});
