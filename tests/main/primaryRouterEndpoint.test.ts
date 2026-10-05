import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUuidv7 } from "../../src/shared/uuidv7";
import {
  createRouterProbeEndpoint,
  createRuntimePrimaryRouter,
} from "../../src/main/primaryRouterEndpoint";
import {
  DEFAULT_PRIMARY_ROUTER_POLICY,
  type RouterDiscoveryRecord,
} from "../../src/main/primaryRouterCoordination";

const policy = {
  ...DEFAULT_PRIMARY_ROUTER_POLICY,
  probeTimeoutMs: 200,
  scanIntervalMs: 10,
  statusFreshnessMs: 2000,
  unreachableFailureThreshold: 2,
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
});
async function temporaryDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pg-election-test-"),
  );
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const pause = () =>
  new Promise((resolve) => setTimeout(resolve, policy.scanIntervalMs + 1));

describe("bounded process-specific probe endpoints", () => {
  it("requires a valid secret and run identity, and rejects missing/stopped endpoints", async () => {
    const directory = await temporaryDirectory();
    const self: RouterDiscoveryRecord = {
      schemaVersion: 1,
      scope: "test",
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      probeSecret: "a".repeat(64),
    };
    const endpointFor = (record: { instanceRunId: string }) =>
      process.platform === "win32"
        ? `\\\\.\\pipe\\pg-probe-test-${record.instanceRunId}`
        : path.join(directory, `${record.instanceRunId}.sock`);
    const endpoint = createRouterProbeEndpoint(self, endpointFor, policy);
    cleanup.push(() => endpoint.close());
    await endpoint.listen();
    expect(await endpoint.probe(self)).toBe(true);
    expect(await endpoint.probe({ ...self, probeSecret: "b".repeat(64) })).toBe(
      false,
    );
    expect(await endpoint.probe({ ...self, startedAt: 2 })).toBe(false);
    expect(
      await endpoint.probe({ ...self, instanceRunId: createUuidv7() }),
    ).toBe(false);
    for (const payload of [
      "not json\n",
      '{"kind":"launch","target":"A.pergamum"}\n',
      "x".repeat(policy.maxFrameBytes + 1),
    ]) {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(endpointFor(self));
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error("Connection was not bounded"));
        }, policy.probeTimeoutMs * 4);
        socket.on("error", () => undefined);
        socket.on("connect", () => socket.write(payload));
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    expect(await endpoint.probe(self)).toBe(true);
    endpoint.deactivate();
    expect(await endpoint.probe(self)).toBe(false);
    await endpoint.close();
    expect(await endpoint.probe(self)).toBe(false);
  });
  it("bounds a silent client with the injected timeout", async () => {
    const directory = await temporaryDirectory();
    const self: RouterDiscoveryRecord = {
      schemaVersion: 1,
      scope: "test",
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      probeSecret: "c".repeat(64),
    };
    const endpointPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\pg-probe-test-${self.instanceRunId}`
        : path.join(directory, "probe.sock");
    const endpoint = createRouterProbeEndpoint(self, () => endpointPath, {
      ...policy,
      probeTimeoutMs: 20,
    });
    cleanup.push(() => endpoint.close());
    await endpoint.listen();
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(endpointPath);
      const guard = setTimeout(() => {
        socket.destroy();
        reject(new Error("Silent client survived timeout"));
      }, 1000);
      socket.on("error", () => undefined);
      socket.on("close", () => {
        clearTimeout(guard);
        resolve();
      });
    });
  });
});

describe("filesystem discovery and live coordination adapter", () => {
  it("stabilizes two runs, takes over on exit, and leaves unrelated ownership artifacts untouched", async () => {
    const directory = await temporaryDirectory();
    const artifact = path.join(directory, "Recovery.lock.fixture");
    await fs.writeFile(artifact, "untouched");
    const a = await createRuntimePrimaryRouter({
      userDataPath: directory,
      mode: "development",
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      policy,
    });
    const b = await createRuntimePrimaryRouter({
      userDataPath: directory,
      mode: "development",
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 2,
      policy,
    });
    cleanup.push(
      () => a.stop(),
      () => b.stop(),
    );
    await Promise.all([a.start(), b.start()]);
    for (let i = 0; i < 3; i++) {
      await pause();
      await Promise.all([a.refresh(), b.refresh()]);
    }
    expect(a.current().kind).toBe("primary");
    expect(b.current().kind).toBe("secondary");
    const recordsPath = path.join(
      directory,
      "runtime-launch-routing",
      "development",
      "v1",
      "instances",
    );
    const names = await fs.readdir(recordsPath);
    expect(names).toHaveLength(2);
    const published = JSON.parse(
      await fs.readFile(path.join(recordsPath, names[0]), "utf8"),
    ) as RouterDiscoveryRecord;
    // A valid-looking stale PID cannot block election: only an authenticated
    // endpoint response qualifies. Malformed and temporary records are ignored.
    const staleId = createUuidv7();
    const stalePath = path.join(recordsPath, `${staleId}.json`);
    await fs.writeFile(
      stalePath,
      JSON.stringify({ ...published, instanceRunId: staleId, startedAt: 0.5 }),
    );
    await fs.writeFile(
      path.join(recordsPath, `${createUuidv7()}.json`),
      "partial JSON",
    );
    await fs.writeFile(
      path.join(recordsPath, `${createUuidv7()}.json.pergamum-tmp-fixture`),
      "partial",
    );
    for (let i = 0; i < 4; i++) {
      await pause();
      await Promise.all([a.refresh(), b.refresh()]);
    }
    expect(a.current().kind).toBe("primary");
    await a.stop();
    for (let i = 0; i < 3; i++) {
      await pause();
      await b.refresh();
    }
    expect(b.current().kind).toBe("primary");
    expect(await fs.readFile(artifact, "utf8")).toBe("untouched");
    expect(await fs.readFile(stalePath, "utf8")).toContain(staleId);
    await b.stop();
    expect(
      (await fs.readdir(recordsPath)).filter((name) => names.includes(name)),
    ).toEqual([]);
  });
  it("does not silently elect self when the coordination directory disappears", async () => {
    const directory = await temporaryDirectory();
    const a = await createRuntimePrimaryRouter({
      userDataPath: directory,
      mode: "development",
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      policy,
    });
    cleanup.push(() => a.stop());
    await a.start();
    await fs.rm(path.join(directory, "runtime-launch-routing"), {
      recursive: true,
      force: true,
    });
    await pause();
    await a.refresh();
    expect(a.current().kind).toBe("unavailable");
  });
});
