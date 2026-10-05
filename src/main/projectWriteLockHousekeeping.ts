import path from "node:path";

export const STALE_LOCK_ARCHIVE_RETENTION_COUNT = 0;

export interface ProjectWriteLockHousekeepingFileSystem {
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }>;
  rmdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm?(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
}

export interface ParsedStaleArchiveName {
  readonly originalName: string;
  readonly timestampString: string;
  readonly fragment: string;
}

/**
 * Single source of truth generator for stale archive directory names.
 * Format: `${base}.stale-${timestamp}-${fragment}`
 * e.g., `.pergamum.lock.stale-2026-08-29T10-00-00-000Z-0198d95f`
 */
export function createProjectWriteLockStaleArchiveDirName(
  lockDirectoryPath: string,
  now: Date,
  instanceRunId: string
): string {
  const base = path.basename(lockDirectoryPath);
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const fragment =
    instanceRunId.replace(/[^0-9a-fA-F]/g, "").slice(0, 8) || "run";

  return `${base}.stale-${timestamp}-${fragment}`;
}

const STALE_ARCHIVE_NAME_REGEX =
  /^\.pergamum\.lock\.stale-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([0-9a-fA-F]{1,8}|run)$/;

/**
 * Single source of truth parser/matcher for stale archive directory names.
 * Returns ParsedStaleArchiveName if it strictly matches the official naming rule, otherwise null.
 */
export function parseProjectWriteLockStaleArchiveDirName(
  dirName: string
): ParsedStaleArchiveName | null {
  const match = STALE_ARCHIVE_NAME_REGEX.exec(dirName);
  if (!match) {
    return null;
  }
  return {
    originalName: dirName,
    timestampString: match[1],
    fragment: match[2]
  };
}

/**
 * Best-effort housekeeping for stale project write lock archives in the project root directory.
 * Cleans up all stale lock archive directories once write ownership is safely established.
 * Retention is 0 (stale archives are temporary fallbacks during stale takeover).
 */
export async function cleanStaleProjectWriteLockArchives(
  lockDirectoryPath: string,
  fileSystem: ProjectWriteLockHousekeepingFileSystem
): Promise<void> {
  const projectRootPath = path.dirname(lockDirectoryPath);

  let entries: string[];
  try {
    entries = await fileSystem.readdir(projectRootPath);
  } catch {
    // Root scan failure -> return silently (best-effort)
    return;
  }

  const matchedArchives: ParsedStaleArchiveName[] = [];
  for (const entryName of entries) {
    const parsed = parseProjectWriteLockStaleArchiveDirName(entryName);
    if (parsed) {
      matchedArchives.push(parsed);
    }
  }

  if (matchedArchives.length <= STALE_LOCK_ARCHIVE_RETENTION_COUNT) {
    return;
  }

  // Sort matched archives newest first (descending) for deterministic processing order.
  matchedArchives.sort((a, b) => {
    if (a.timestampString !== b.timestampString) {
      return b.timestampString.localeCompare(a.timestampString);
    }
    return b.originalName.localeCompare(a.originalName);
  });

  const archivesToDelete = matchedArchives.slice(
    STALE_LOCK_ARCHIVE_RETENTION_COUNT
  );

  for (const archive of archivesToDelete) {
    const archivePath = path.join(projectRootPath, archive.originalName);

    try {
      const stats = await fileSystem.lstat(archivePath);
      // Safety check: Must be a real directory and NOT a symlink / junction
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        continue;
      }
    } catch {
      // lstat failure -> skip
      continue;
    }

    try {
      if (typeof fileSystem.rm === "function") {
        await fileSystem.rm(archivePath, { recursive: true, force: true });
      } else if (typeof fileSystem.rmdir === "function") {
        await fileSystem.rmdir(archivePath, { recursive: true });
      }
    } catch {
      // Individual delete failure -> skip / continue
    }
  }
}
