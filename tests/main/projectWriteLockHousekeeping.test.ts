import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanStaleProjectWriteLockArchives,
  createProjectWriteLockStaleArchiveDirName,
  parseProjectWriteLockStaleArchiveDirName,
  STALE_LOCK_ARCHIVE_RETENTION_COUNT,
  type ProjectWriteLockHousekeepingFileSystem
} from "../../src/main/projectWriteLockHousekeeping";
import {
  ProjectWriteLockOwnershipManager,
  type ProjectWriteLockFileHandle,
  type ProjectWriteLockFileSystem
} from "../../src/main/projectIpc";
import { projectLockOwnerMetadataFileName } from "../../src/main/projectLockOwnerMetadata";

describe("projectWriteLockHousekeeping", () => {
  describe("generator & parser (single source of truth)", () => {
    it("parses valid stale archive directory names created by generator", () => {
      const lockPath = path.join("C:", "Project", ".pergamum.lock");
      const date = new Date("2026-08-29T10:00:00.000Z");
      const runId = "0198d95f-1234";

      const dirName = createProjectWriteLockStaleArchiveDirName(
        lockPath,
        date,
        runId
      );

      expect(dirName).toBe(
        ".pergamum.lock.stale-2026-08-29T10-00-00-000Z-0198d95f"
      );

      const parsed = parseProjectWriteLockStaleArchiveDirName(dirName);
      expect(parsed).not.toBeNull();
      expect(parsed?.originalName).toBe(dirName);
      expect(parsed?.timestampString).toBe("2026-08-29T10-00-00-000Z");
      expect(parsed?.fragment).toBe("0198d95f");
    });

    it("parses 'run' fragment fallback when instanceRunId has no hex characters", () => {
      const lockPath = "/project/.pergamum.lock";
      const date = new Date("2026-08-29T10:00:00.000Z");

      const dirName = createProjectWriteLockStaleArchiveDirName(
        lockPath,
        date,
        "---"
      );

      expect(dirName).toBe(".pergamum.lock.stale-2026-08-29T10-00-00-000Z-run");
      const parsed = parseProjectWriteLockStaleArchiveDirName(dirName);
      expect(parsed?.fragment).toBe("run");
    });

    it("returns null for malformed or non-matching archive names", () => {
      expect(parseProjectWriteLockStaleArchiveDirName(".pergamum.lock")).toBeNull();
      expect(
        parseProjectWriteLockStaleArchiveDirName(".pergamum.lock.stale-custom")
      ).toBeNull();
      expect(
        parseProjectWriteLockStaleArchiveDirName(
          ".pergamum.lock.stale-2026-08-29T10:00:00Z-0198d95f"
        )
      ).toBeNull();
      expect(
        parseProjectWriteLockStaleArchiveDirName(
          ".pergamum.lock.stale-2026-08-29-0198d95f"
        )
      ).toBeNull();
    });
  });

  describe("cleanStaleProjectWriteLockArchives (retention=0)", () => {
    it("1. does nothing if stale archive count is 0", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [".pergamum.lock"],
        lstat: async () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false
        }),
        rm: async (p) => {
          removedPaths.push(p);
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);
      expect(removedPaths).toEqual([]);
    });

    it("2. deletes the single stale archive if 1 exists", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const singleArchive =
        ".pergamum.lock.stale-2026-08-29T10-00-00-000Z-0198d95f";

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [".pergamum.lock", singleArchive],
        lstat: async () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false
        }),
        rm: async (p) => {
          removedPaths.push(path.basename(p));
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);
      expect(removedPaths).toEqual([singleArchive]);
    });

    it("3. deletes all matching real directories when multiple stale archives exist", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const oldest = ".pergamum.lock.stale-2026-08-27T10-00-00-000Z-00000001";
      const middle = ".pergamum.lock.stale-2026-08-28T10-00-00-000Z-00000002";
      const newest = ".pergamum.lock.stale-2026-08-29T10-00-00-000Z-00000003";

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [".pergamum.lock", oldest, newest, middle],
        lstat: async () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false
        }),
        rm: async (p) => {
          removedPaths.push(path.basename(p));
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);

      expect(removedPaths).toEqual([newest, middle, oldest]);
    });

    it("4. does not delete active .pergamum.lock directory", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [".pergamum.lock"],
        lstat: async () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false
        }),
        rm: async (p) => {
          removedPaths.push(path.basename(p));
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);
      expect(removedPaths).toEqual([]);
    });

    it("5. does not delete malformed names or directories with similar prefixes", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [
          ".pergamum.lock.stale-user-custom",
          ".pergamum.lock.stale-backup",
          ".pergamum.lock.stale-invalid-date-xyz",
          ".pergamum.lock.stale-20260830",
          ".pergamum.lock.stale-2026-08-28T10-00-00-000Z-00000002"
        ],
        lstat: async () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false
        }),
        rm: async (p) => {
          removedPaths.push(path.basename(p));
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);
      expect(removedPaths).toEqual([
        ".pergamum.lock.stale-2026-08-28T10-00-00-000Z-00000002"
      ]);
    });

    it("6. does not delete regular files even if their names match official pattern", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const matchingRegularFile =
        ".pergamum.lock.stale-2026-08-27T10-00-00-000Z-00000001";
      const matchingDir =
        ".pergamum.lock.stale-2026-08-28T10-00-00-000Z-00000002";

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [matchingRegularFile, matchingDir],
        lstat: async (p) => {
          const name = path.basename(p);
          return {
            isDirectory: () => name !== matchingRegularFile,
            isSymbolicLink: () => false
          };
        },
        rm: async (p) => {
          removedPaths.push(path.basename(p));
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);
      expect(removedPaths).toEqual([matchingDir]);
    });

    it("7. does not delete symlink/junction targets even if their names match official pattern", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const removedPaths: string[] = [];

      const symlinkDir =
        ".pergamum.lock.stale-2026-08-27T10-00-00-000Z-00000001";
      const realDir =
        ".pergamum.lock.stale-2026-08-28T10-00-00-000Z-00000002";

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [symlinkDir, realDir],
        lstat: async (p) => {
          const name = path.basename(p);
          return {
            isDirectory: () => true,
            isSymbolicLink: () => name === symlinkDir
          };
        },
        rm: async (p) => {
          removedPaths.push(path.basename(p));
        }
      };

      await cleanStaleProjectWriteLockArchives(lockPath, mockFs);
      expect(removedPaths).toEqual([realDir]);
    });

    it("8. continues housekeeping when individual delete fails", async () => {
      const lockPath = path.join("/project", ".pergamum.lock");
      const attemptedDeletes: string[] = [];

      const archive1 = ".pergamum.lock.stale-2026-08-25T10-00-00-000Z-00000001";
      const archive2 = ".pergamum.lock.stale-2026-08-26T10-00-00-000Z-00000002";
      const archive3 = ".pergamum.lock.stale-2026-08-27T10-00-00-000Z-00000003";

      const mockFs: ProjectWriteLockHousekeepingFileSystem = {
        readdir: async () => [archive1, archive2, archive3],
        lstat: async () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false
        }),
        rm: async (p) => {
          const name = path.basename(p);
          attemptedDeletes.push(name);
          if (name === archive3) {
            throw new Error("EPERM: Permission denied");
          }
        }
      };

      await expect(
        cleanStaleProjectWriteLockArchives(lockPath, mockFs)
      ).resolves.not.toThrow();

      expect(attemptedDeletes).toEqual([archive3, archive2, archive1]);
    });
  });

  describe("ProjectWriteLockOwnershipManager integration with retention=0 housekeeping", () => {
    it("9. returns owned ownership even if housekeepingCleaner throws an error", async () => {
      const projectFilePath = path.resolve(
        path.join(process.cwd(), "temp-test-project-1", "index.pergamum")
      );

      const mockHandle: ProjectWriteLockFileHandle = {
        writeFile: async () => {},
        close: async () => {}
      };

      const fileStore = new Map<string, string>();

      const mockFileSystem: ProjectWriteLockFileSystem = {
        mkdir: async () => {},
        writeFile: async (p, content) => {
          fileStore.set(path.resolve(p), content);
        },
        open: async (p) => {
          fileStore.set(path.resolve(p), "");
          return mockHandle;
        },
        unlink: async (p) => {
          fileStore.delete(path.resolve(p));
        },
        rmdir: async () => {},
        readFile: async (p) => {
          const content = fileStore.get(path.resolve(p));
          if (content !== undefined) {
            return content;
          }
          const err = new Error("ENOENT: no such file");
          (err as unknown as { code: string }).code = "ENOENT";
          throw err;
        },
        rename: async () => {},
        stat: async () => ({ isDirectory: () => true })
      };

      const failingHousekeeping = async () => {
        throw new Error("Housekeeping unexpected crash!");
      };

      const manager = new ProjectWriteLockOwnershipManager(
        mockFileSystem,
        {
          now: () => new Date("2026-08-29T10:00:00.000Z"),
          hostname: () => "host",
          appVersion: () => "1.0.0",
          pid: () => 1234
        },
        { probeProcessLiveness: () => "dead" },
        failingHousekeeping
      );

      const result = await manager.acquire(projectFilePath, {
        projectId: "test-proj",
        sessionId: "test-sess"
      });

      expect(result.kind).toBe("owned");
    });

    it("10. leaves only active .pergamum.lock in steady state (0 stale archives) after stale takeover success", async () => {
      const projectFilePath = path.resolve(
        path.join(process.cwd(), "temp-test-project-2", "index.pergamum")
      );
      const projectRoot = path.dirname(projectFilePath);
      const lockDir = path.join(projectRoot, ".pergamum.lock");

      const fileStore = new Map<string, string>();
      const existingDirs = new Set<string>();

      const norm = (p: string) => path.resolve(p);

      // Pre-existing old stale archive
      const oldStaleArchive = norm(
        path.join(
          projectRoot,
          ".pergamum.lock.stale-2026-08-20T00-00-00-000Z-00000001"
        )
      );
      existingDirs.add(oldStaleArchive);

      // Existing dead owner lock directory
      const normLockDir = norm(lockDir);
      existingDirs.add(normLockDir);
      fileStore.set(
        norm(path.join(lockDir, projectLockOwnerMetadataFileName)),
        JSON.stringify({
          schemaVersion: 1,
          projectId: "proj-1",
          sessionId: "sess-dead",
          pid: 9999,
          hostname: "host",
          appVersion: "1.0.0",
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z"
        })
      );

      const mockHandle: ProjectWriteLockFileHandle = {
        writeFile: async () => {},
        close: async () => {}
      };

      let createdStaleArchiveName: string | null = null;

      const mockFs: ProjectWriteLockFileSystem = {
        mkdir: async (p) => {
          const np = norm(p);
          if (existingDirs.has(np)) {
            const err = new Error("EEXIST: file already exists");
            (err as unknown as { code: string }).code = "EEXIST";
            throw err;
          }
          existingDirs.add(np);
        },
        writeFile: async (p, content) => {
          fileStore.set(norm(p), content);
        },
        open: async (p) => {
          fileStore.set(norm(p), "");
          return mockHandle;
        },
        unlink: async (p) => {
          fileStore.delete(norm(p));
        },
        rmdir: async (p) => {
          existingDirs.delete(norm(p));
        },
        rm: async (p) => {
          existingDirs.delete(norm(p));
        },
        readFile: async (p) => {
          const np = norm(p);
          const data = fileStore.get(np);
          if (!data) {
            const err = new Error("ENOENT: no such file or directory");
            (err as unknown as { code: string }).code = "ENOENT";
            throw err;
          }
          return data;
        },
        rename: async (from, to) => {
          const nFrom = norm(from);
          const nTo = norm(to);
          existingDirs.delete(nFrom);
          existingDirs.add(nTo);
          createdStaleArchiveName = path.basename(nTo);
          for (const [filePath, content] of Array.from(fileStore.entries())) {
            if (filePath.startsWith(nFrom)) {
              const rel = filePath.slice(nFrom.length);
              fileStore.delete(filePath);
              fileStore.set(norm(path.join(nTo, rel)), content);
            }
          }
        },
        stat: async (p) => ({
          isDirectory: () => existingDirs.has(norm(p))
        }),
        readdir: async (p) => {
          const targetDir = norm(p);
          const results: string[] = [];
          for (const dir of existingDirs) {
            if (norm(path.dirname(dir)) === targetDir) {
              results.push(path.basename(dir));
            }
          }
          return results;
        },
        lstat: async (p) => ({
          isDirectory: () => existingDirs.has(norm(p)),
          isSymbolicLink: () => false
        })
      };

      const manager = new ProjectWriteLockOwnershipManager(
        mockFs,
        {
          now: () => new Date("2026-08-29T12:00:00.000Z"),
          hostname: () => "host",
          appVersion: () => "1.0.0",
          pid: () => 1234
        },
        { probeProcessLiveness: () => "dead" }
      );

      const result = await manager.acquire(projectFilePath, {
        projectId: "proj-1",
        sessionId: "sess-fresh",
        instanceRunId: "0198d95f"
      });

      expect(result.kind).toBe("owned");
      expect(result.staleTakeover?.phase).toBe("reacquired");

      // Verify that all stale archives (both pre-existing and newly created during takeover)
      // are cleaned up after ownership is established, leaving only active `.pergamum.lock`
      expect(existingDirs.has(oldStaleArchive)).toBe(false);
      expect(createdStaleArchiveName).not.toBeNull();
      expect(
        existingDirs.has(norm(path.join(projectRoot, createdStaleArchiveName!)))
      ).toBe(false);
      expect(existingDirs.has(normLockDir)).toBe(true);
      expect(STALE_LOCK_ARCHIVE_RETENTION_COUNT).toBe(0);
    });

    it("11. preserves stale archive when reacquire fails during stale takeover", async () => {
      const projectFilePath = path.resolve(
        path.join(process.cwd(), "temp-test-project-3", "index.pergamum")
      );
      const projectRoot = path.dirname(projectFilePath);
      const lockDir = path.join(projectRoot, ".pergamum.lock");

      const fileStore = new Map<string, string>();
      const existingDirs = new Set<string>();
      const norm = (p: string) => path.resolve(p);

      const normLockDir = norm(lockDir);
      existingDirs.add(normLockDir);
      fileStore.set(
        norm(path.join(lockDir, projectLockOwnerMetadataFileName)),
        JSON.stringify({
          schemaVersion: 1,
          projectId: "proj-1",
          sessionId: "sess-dead",
          pid: 9999,
          hostname: "host",
          appVersion: "1.0.0",
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z"
        })
      );

      const mockHandle: ProjectWriteLockFileHandle = {
        writeFile: async () => {},
        close: async () => {}
      };

      let createdStaleArchiveName: string | null = null;

      let lockDirMkdirCount = 0;

      const mockFs: ProjectWriteLockFileSystem = {
        mkdir: async (p) => {
          const np = norm(p);
          if (np === normLockDir) {
            lockDirMkdirCount++;
            if (lockDirMkdirCount === 1) {
              const err = new Error("EEXIST: file already exists");
              (err as unknown as { code: string }).code = "EEXIST";
              throw err;
            } else {
              const err = new Error("EACCES: permission denied");
              (err as unknown as { code: string }).code = "EACCES";
              throw err;
            }
          }
          existingDirs.add(np);
        },
        writeFile: async (p, content) => {
          fileStore.set(norm(p), content);
        },
        open: async (p) => {
          fileStore.set(norm(p), "");
          return mockHandle;
        },
        unlink: async (p) => {
          fileStore.delete(norm(p));
        },
        rmdir: async (p) => {
          existingDirs.delete(norm(p));
        },
        rm: async (p) => {
          existingDirs.delete(norm(p));
        },
        readFile: async (p) => {
          const data = fileStore.get(norm(p));
          if (!data) {
            const err = new Error("ENOENT: no such file or directory");
            (err as unknown as { code: string }).code = "ENOENT";
            throw err;
          }
          return data;
        },
        rename: async (from, to) => {
          const nFrom = norm(from);
          const nTo = norm(to);
          existingDirs.delete(nFrom);
          existingDirs.add(nTo);
          createdStaleArchiveName = path.basename(nTo);
          for (const [filePath, content] of Array.from(fileStore.entries())) {
            if (filePath.startsWith(nFrom)) {
              const rel = filePath.slice(nFrom.length);
              fileStore.delete(filePath);
              fileStore.set(norm(path.join(nTo, rel)), content);
            }
          }
        },
        stat: async (p) => ({
          isDirectory: () => existingDirs.has(norm(p))
        }),
        readdir: async (p) => {
          const targetDir = norm(p);
          const results: string[] = [];
          for (const dir of existingDirs) {
            if (norm(path.dirname(dir)) === targetDir) {
              results.push(path.basename(dir));
            }
          }
          return results;
        },
        lstat: async (p) => ({
          isDirectory: () => existingDirs.has(norm(p)),
          isSymbolicLink: () => false
        })
      };

      const manager = new ProjectWriteLockOwnershipManager(
        mockFs,
        {
          now: () => new Date("2026-08-29T12:00:00.000Z"),
          hostname: () => "host",
          appVersion: () => "1.0.0",
          pid: () => 1234
        },
        { probeProcessLiveness: () => "dead" }
      );

      const result = await manager.acquire(projectFilePath, {
        projectId: "proj-1",
        sessionId: "sess-fresh",
        instanceRunId: "0198d95f"
      });

      // Acquisition failed during reacquire
      expect(result.kind).toBe("unavailable");
      expect(result.staleTakeover?.phase).toBe("reacquireFailed");

      // Verify that the archived stale lock was PRESERVED because ownership was not established
      expect(createdStaleArchiveName).not.toBeNull();
      expect(
        existingDirs.has(norm(path.join(projectRoot, createdStaleArchiveName!)))
      ).toBe(true);
    });
  });
});
