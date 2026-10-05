import { isUuidv7 } from "../shared/uuidv7";

export interface RouterProcessDescriptor {
  readonly instanceRunId: string;
  readonly pid: number;
  /** Node timeOrigin: coordination ordering, not native OS creation time. */
  readonly startedAt: number;
}

export interface RouterDiscoveryRecord extends RouterProcessDescriptor {
  readonly schemaVersion: 1;
  readonly scope: string;
  readonly probeSecret: string;
}

export interface PrimaryRouterPolicy {
  readonly probeTimeoutMs: number;
  readonly scanIntervalMs: number;
  readonly stableObservationCount: number;
  readonly unreachableFailureThreshold: number;
  readonly statusFreshnessMs: number;
  readonly maxRecordBytes: number;
  readonly maxFrameBytes: number;
  readonly maxRecords: number;
  readonly maxConnections: number;
}

export const DEFAULT_PRIMARY_ROUTER_POLICY: PrimaryRouterPolicy = {
  probeTimeoutMs: 1000,
  scanIntervalMs: 1000,
  stableObservationCount: 2,
  unreachableFailureThreshold: 3,
  statusFreshnessMs: 5000,
  maxRecordBytes: 4096,
  maxFrameBytes: 4096,
  maxRecords: 256,
  maxConnections: 16,
};

export function validatePrimaryRouterPolicy(policy: PrimaryRouterPolicy): void {
  for (const value of Object.values(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Invalid Primary Router policy.");
    }
  }
  if (
    policy.stableObservationCount < 2 ||
    policy.statusFreshnessMs <= policy.scanIntervalMs
  ) {
    throw new Error(
      "Primary Router policy must allow stabilization and fresh observations.",
    );
  }
}

export function parseRouterDiscoveryRecord(
  value: unknown,
  scope: string,
): RouterDiscoveryRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    record.scope !== scope ||
    !isUuidv7(record.instanceRunId) ||
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.startedAt !== "number" ||
    !Number.isFinite(record.startedAt) ||
    record.startedAt <= 0 ||
    typeof record.probeSecret !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.probeSecret)
  )
    return null;
  return {
    schemaVersion: 1,
    scope,
    instanceRunId: record.instanceRunId,
    pid: record.pid,
    startedAt: record.startedAt,
    probeSecret: record.probeSecret,
  };
}

export function compareRouterProcesses(
  a: RouterProcessDescriptor,
  b: RouterProcessDescriptor,
): number {
  return (
    a.startedAt - b.startedAt ||
    (a.instanceRunId < b.instanceRunId
      ? -1
      : a.instanceRunId > b.instanceRunId
        ? 1
        : 0)
  );
}

function descriptor(record: RouterProcessDescriptor): RouterProcessDescriptor {
  return {
    instanceRunId: record.instanceRunId,
    pid: record.pid,
    startedAt: record.startedAt,
  };
}

export type PrimaryRouterStatus =
  | { readonly kind: "discovering" }
  | { readonly kind: "primary"; readonly self: RouterProcessDescriptor }
  | { readonly kind: "secondary"; readonly primary: RouterProcessDescriptor }
  | { readonly kind: "unavailable"; readonly reason: "coordinationFailure" }
  | { readonly kind: "stopping" };

export interface PrimaryRouterCoordinationDeps {
  readonly register: () => Promise<void>;
  readonly list: () => Promise<readonly RouterDiscoveryRecord[]>;
  readonly probe: (record: RouterDiscoveryRecord) => Promise<boolean>;
  readonly unregister: () => Promise<void>;
  readonly markStopping?: () => void;
  /** Monotonic observation clock; unrelated to startedAt ordering. */
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}

export interface PrimaryRouterCoordinator {
  start(): Promise<void>;
  refresh(): Promise<PrimaryRouterStatus>;
  current(): PrimaryRouterStatus;
  stop(): Promise<void>;
}

export function createPrimaryRouterCoordinator(
  self: RouterDiscoveryRecord,
  deps: PrimaryRouterCoordinationDeps,
  policy: PrimaryRouterPolicy = DEFAULT_PRIMARY_ROUTER_POLICY,
): PrimaryRouterCoordinator {
  validatePrimaryRouterPolicy(policy);
  let status: PrimaryRouterStatus = { kind: "discovering" };
  let registered = false;
  let stopping = false;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let refreshPromise: Promise<PrimaryRouterStatus> | null = null;
  let cancelScheduled: (() => void) | null = null;
  let lastObservation: number | null = null;
  let winnerId: string | null = null;
  let stableCount = 0;
  const failures = new Map<string, number>();

  function resetStability(): void {
    winnerId = null;
    stableCount = 0;
    lastObservation = null;
  }

  function current(): PrimaryRouterStatus {
    if (
      (status.kind === "primary" || status.kind === "secondary") &&
      (lastObservation === null ||
        deps.now() - lastObservation > policy.statusFreshnessMs)
    ) {
      resetStability();
      status = { kind: "discovering" };
    }
    return status;
  }

  async function observe(): Promise<PrimaryRouterStatus> {
    if (stopping || !registered) return current();
    current();
    // Manual refreshes cannot speed through the stabilization policy.
    if (
      lastObservation !== null &&
      deps.now() - lastObservation < policy.scanIntervalMs
    )
      return current();
    try {
      const records = await deps.list();
      if (
        records.length > policy.maxRecords ||
        !records.some(
          (record) =>
            record.instanceRunId === self.instanceRunId &&
            record.pid === self.pid &&
            record.startedAt === self.startedAt &&
            record.probeSecret === self.probeSecret,
        )
      ) {
        throw new Error("Incomplete coordination discovery.");
      }
      const observed = await Promise.all(
        records.map(async (record) => ({
          record,
          reachable: await deps.probe(record).catch(() => false),
        })),
      );
      if (stopping) return status;
      const present = new Set(records.map((record) => record.instanceRunId));
      for (const id of failures.keys())
        if (!present.has(id)) failures.delete(id);
      const candidates = observed
        .filter(({ record, reachable }) => {
          const count = reachable
            ? 0
            : (failures.get(record.instanceRunId) ?? 0) + 1;
          failures.set(record.instanceRunId, count);
          return count < policy.unreachableFailureThreshold;
        })
        .sort((a, b) => compareRouterProcesses(a.record, b.record));
      const winner = candidates[0];
      const completedAt = deps.now();
      if (
        lastObservation !== null &&
        completedAt - lastObservation > policy.statusFreshnessMs
      )
        resetStability();
      lastObservation = completedAt;
      if (!winner?.reachable) {
        winnerId = null;
        stableCount = 0;
        status = { kind: "discovering" };
        return status;
      }
      stableCount =
        winnerId === winner.record.instanceRunId ? stableCount + 1 : 1;
      winnerId = winner.record.instanceRunId;
      if (stableCount < policy.stableObservationCount)
        status = { kind: "discovering" };
      else
        status =
          winnerId === self.instanceRunId
            ? { kind: "primary", self: descriptor(self) }
            : { kind: "secondary", primary: descriptor(winner.record) };
    } catch {
      if (!stopping) {
        resetStability();
        status = { kind: "unavailable", reason: "coordinationFailure" };
      }
    }
    return status;
  }

  function refresh(): Promise<PrimaryRouterStatus> {
    refreshPromise ??= observe().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function scheduleNext(): void {
    if (stopping || !registered) return;
    cancelScheduled = deps.schedule(() => {
      cancelScheduled = null;
      void refresh().finally(scheduleNext);
    }, policy.scanIntervalMs);
  }

  function start(): Promise<void> {
    startPromise ??= (async () => {
      if (stopping) return;
      try {
        await deps.register();
        registered = true;
        if (!stopping) {
          await refresh();
          scheduleNext();
        }
      } catch {
        if (!stopping)
          status = { kind: "unavailable", reason: "coordinationFailure" };
        await deps.unregister().catch(() => undefined);
      }
    })();
    return startPromise;
  }

  function stop(): Promise<void> {
    stopPromise ??= (async () => {
      stopping = true;
      status = { kind: "stopping" };
      deps.markStopping?.();
      cancelScheduled?.();
      await startPromise;
      await refreshPromise;
      await deps.unregister().catch(() => undefined);
      registered = false;
    })();
    return stopPromise;
  }

  return { start, refresh, current, stop };
}

export interface PrimaryRouterQuitTarget {
  on(
    event: "will-quit",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  quit(): void;
}

/** Quit requests can still be cancelled by dirty-document resolution. Only
 * relinquish once Electron reaches will-quit; crashes rely on failed probes.
 */
export function installPrimaryRouterShutdown(
  app: PrimaryRouterQuitTarget,
  stop: () => Promise<void>,
): void {
  let stopping: Promise<void> | null = null;
  let complete = false;
  app.on("will-quit", (event) => {
    if (complete) return;
    event.preventDefault();
    stopping ??= Promise.resolve()
      .then(stop)
      .catch(() => undefined)
      .finally(() => {
        complete = true;
        app.quit();
      });
  });
}
