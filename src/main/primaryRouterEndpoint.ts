import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { writeFileAtomic, isAtomicWriteTempFileName } from "./atomicFileWrite";
import { isUuidv7 } from "../shared/uuidv7";
import {
  createPrimaryRouterCoordinator,
  DEFAULT_PRIMARY_ROUTER_POLICY,
  parseRouterDiscoveryRecord,
  validatePrimaryRouterPolicy,
  type PrimaryRouterCoordinator,
  type PrimaryRouterPolicy,
  type RouterDiscoveryRecord,
  type RouterProcessDescriptor,
} from "./primaryRouterCoordination";

function proof(
  record: RouterDiscoveryRecord,
  direction: "request" | "response",
  nonce: string,
): string {
  return createHmac("sha256", record.probeSecret)
    .update(
      JSON.stringify([
        direction,
        record.schemaVersion,
        record.scope,
        record.instanceRunId,
        record.pid,
        record.startedAt,
        nonce,
      ]),
    )
    .digest("hex");
}

function matchesProof(actual: unknown, expected: string): boolean {
  return (
    typeof actual === "string" &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}

function parseFrame(frame: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(frame);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One bounded frame, no launch targets. A bare successful connection is not
 * reachability proof: the peer must know this run's private record secret.
 */
function receiveFrame(
  socket: net.Socket,
  limit: number,
  onFrame: (frame: string) => void,
): void {
  let pending = Buffer.alloc(0);
  let complete = false;
  socket.on("data", (chunk: Buffer) => {
    if (complete || pending.length + chunk.length > limit) {
      socket.destroy();
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    const end = pending.indexOf(10);
    if (end < 0) return;
    complete = true;
    if (end !== pending.length - 1) socket.destroy();
    else onFrame(pending.subarray(0, end).toString("utf8"));
  });
}

export interface RouterProbeEndpoint {
  listen(): Promise<void>;
  probe(record: RouterDiscoveryRecord): Promise<boolean>;
  deactivate(): void;
  close(): Promise<void>;
}

export function createRouterProbeEndpoint(
  self: RouterDiscoveryRecord,
  endpointFor: (record: RouterProcessDescriptor) => string,
  policy: PrimaryRouterPolicy = DEFAULT_PRIMARY_ROUTER_POLICY,
): RouterProbeEndpoint {
  validatePrimaryRouterPolicy(policy);
  let accepting = false;
  let stopping = false;
  let listening = false;
  let closePromise: Promise<void> | null = null;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const deadline = setTimeout(() => socket.destroy(), policy.probeTimeoutMs);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(deadline);
      sockets.delete(socket);
    });
    receiveFrame(socket, policy.maxFrameBytes, (frame) => {
      const request = parseFrame(frame);
      if (
        !accepting ||
        request?.kind !== "probe" ||
        typeof request.nonce !== "string" ||
        !/^[a-f0-9]{64}$/.test(request.nonce) ||
        !matchesProof(request.proof, proof(self, "request", request.nonce))
      ) {
        socket.destroy();
        return;
      }
      socket.end(
        `${JSON.stringify({
          kind: "probeResult",
          instanceRunId: self.instanceRunId,
          nonce: request.nonce,
          proof: proof(self, "response", request.nonce),
        })}\n`,
      );
    });
  });
  server.maxConnections = policy.maxConnections;
  // A later listener error removes this run from reachability, not from
  // Recovery/Session/Project ownership. No process is killed or replaced.
  server.on("error", () => {
    accepting = false;
  });

  return {
    async listen() {
      if (closePromise) throw new Error("Probe endpoint is closed.");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpointFor(self), () => {
          server.removeListener("error", reject);
          accepting = !stopping;
          listening = true;
          resolve();
        });
      });
    },
    probe(record) {
      return new Promise<boolean>((resolve) => {
        const nonce = randomBytes(32).toString("hex");
        let finished = false;
        const socket = net.createConnection(endpointFor(record));
        sockets.add(socket);
        const deadline = setTimeout(() => finish(false), policy.probeTimeoutMs);
        function finish(reachable: boolean): void {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          sockets.delete(socket);
          socket.destroy();
          resolve(reachable);
        }
        socket.once("connect", () => {
          socket.write(
            `${JSON.stringify({
              kind: "probe",
              nonce,
              proof: proof(record, "request", nonce),
            })}\n`,
          );
        });
        socket.once("error", () => finish(false));
        socket.once("close", () => finish(false));
        receiveFrame(socket, policy.maxFrameBytes, (frame) => {
          const response = parseFrame(frame);
          finish(
            response?.kind === "probeResult" &&
              response.instanceRunId === record.instanceRunId &&
              response.nonce === nonce &&
              matchesProof(response.proof, proof(record, "response", nonce)),
          );
        });
      });
    },
    deactivate() {
      stopping = true;
      accepting = false;
    },
    close() {
      closePromise ??= (async () => {
        stopping = true;
        accepting = false;
        for (const socket of sockets) socket.destroy();
        if (listening) {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          listening = false;
        }
      })();
      return closePromise;
    },
  };
}

export interface CreateRuntimePrimaryRouterOptions extends RouterProcessDescriptor {
  readonly userDataPath: string;
  readonly mode: "packaged" | "development";
  readonly policy?: PrimaryRouterPolicy;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fs.lstat(directory);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (process.platform !== "win32" &&
      ((stats.mode & 0o077) !== 0 || stats.uid !== process.getuid?.()))
  ) {
    throw new Error("Unsafe coordination directory.");
  }
  // On Windows permissions are inherited from userData. chmod is not an
  // ACL check; custom/shared userData is outside this private-user scope.
}

export async function createRuntimePrimaryRouter(
  options: CreateRuntimePrimaryRouterOptions,
): Promise<PrimaryRouterCoordinator> {
  const policy = options.policy ?? DEFAULT_PRIMARY_ROUTER_POLICY;
  validatePrimaryRouterPolicy(policy);
  await fs.mkdir(options.userDataPath, { recursive: true, mode: 0o700 });
  const canonicalUserData = await fs.realpath(options.userDataPath);
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        process.platform === "win32"
          ? canonicalUserData.toLowerCase()
          : canonicalUserData,
        options.mode,
        "launch-routing-v1",
      ]),
    )
    .digest("hex");
  const directory = path.join(
    canonicalUserData,
    "runtime-launch-routing",
    options.mode,
    "v1",
    "instances",
  );
  let ancestor = canonicalUserData;
  for (const segment of [
    "runtime-launch-routing",
    options.mode,
    "v1",
    "instances",
  ]) {
    ancestor = path.join(ancestor, segment);
    await ensurePrivateDirectory(ancestor);
  }
  const socketDirectory = path.join(
    os.tmpdir(),
    `pg-launch-${scope.slice(0, 20)}`,
  );
  if (process.platform !== "win32")
    await ensurePrivateDirectory(socketDirectory);
  const endpointFor = (record: RouterProcessDescriptor): string =>
    process.platform === "win32"
      ? `\\\\.\\pipe\\pergamum-launch-v1-${scope.slice(0, 20)}-${record.instanceRunId}`
      : path.join(socketDirectory, `${record.instanceRunId}.sock`);
  const self: RouterDiscoveryRecord = {
    schemaVersion: 1,
    scope,
    instanceRunId: options.instanceRunId,
    pid: options.pid,
    startedAt: options.startedAt,
    probeSecret: randomBytes(32).toString("hex"),
  };
  if (!parseRouterDiscoveryRecord(self, scope))
    throw new Error("Invalid coordination identity.");
  const ownPath = path.join(directory, `${self.instanceRunId}.json`);
  const endpoint = createRouterProbeEndpoint(self, endpointFor, policy);
  let published = false;

  return createPrimaryRouterCoordinator(
    self,
    {
      async register() {
        // Never publish a candidate whose probe endpoint is not listening yet.
        await endpoint.listen();
        try {
          await fs.lstat(ownPath);
          throw new Error("Coordination identity collision.");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await writeFileAtomic(ownPath, `${JSON.stringify(self)}\n`);
        published = true;
        if (process.platform !== "win32") await fs.chmod(ownPath, 0o600);
      },
      async list() {
        const entries = await fs.readdir(directory);
        const names = entries.filter(
          (name) =>
            !isAtomicWriteTempFileName(name) &&
            name.endsWith(".json") &&
            isUuidv7(name.slice(0, -5)),
        );
        if (names.length > policy.maxRecords)
          throw new Error("Coordination record limit exceeded.");
        const records = await Promise.all(
          names.map(async (name) => {
            try {
              const recordPath = path.join(directory, name);
              const stats = await fs.lstat(recordPath);
              if (
                !stats.isFile() ||
                stats.isSymbolicLink() ||
                stats.size > policy.maxRecordBytes
              )
                return null;
              const text = await fs.readFile(recordPath, "utf8");
              if (Buffer.byteLength(text) > policy.maxRecordBytes) return null;
              const record = parseRouterDiscoveryRecord(
                JSON.parse(text),
                scope,
              );
              return record?.instanceRunId === name.slice(0, -5)
                ? record
                : null;
            } catch (error) {
              if (
                error instanceof SyntaxError ||
                (error as NodeJS.ErrnoException).code === "ENOENT"
              )
                return null;
              throw error;
            }
          }),
        );
        return records.filter(
          (record): record is RouterDiscoveryRecord => record !== null,
        );
      },
      probe: (record) => endpoint.probe(record),
      markStopping: () => endpoint.deactivate(),
      async unregister() {
        await endpoint.close();
        if (published) {
          // Only our run's record; no foreign artifacts or ownership locks.
          await fs.unlink(ownPath).catch(() => undefined);
          published = false;
        }
      },
      now: () => performance.now(),
      schedule(callback, delayMs) {
        const timer = setTimeout(callback, delayMs);
        timer.unref();
        return () => clearTimeout(timer);
      },
    },
    policy,
  );
}
