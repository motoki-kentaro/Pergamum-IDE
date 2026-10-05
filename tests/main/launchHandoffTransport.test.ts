import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createUuidv7 } from "../../src/shared/uuidv7";
import {
  createRouterProbeEndpoint,
  createRuntimePrimaryRouter,
} from "../../src/main/primaryRouterEndpoint";
import {
  DEFAULT_PRIMARY_ROUTER_POLICY,
  type PrimaryRouterStatus,
  type RouterDiscoveryRecord,
} from "../../src/main/primaryRouterCoordination";
import { launchHandoffProof } from "../../src/main/launchHandoff";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const policy = {
  ...DEFAULT_PRIMARY_ROUTER_POLICY,
  probeTimeoutMs: 300,
  scanIntervalMs: 10,
  statusFreshnessMs: 10000,
};
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pg-handoff-"));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const record: RouterDiscoveryRecord = {
    schemaVersion: 1,
    scope: "test",
    instanceRunId: createUuidv7(),
    pid: process.pid,
    startedAt: 1,
    probeSecret: "a".repeat(64),
  };
  const endpointFor = (r: { instanceRunId: string }) =>
    process.platform === "win32"
      ? ["", "", ".", "pipe", "pg-test-" + r.instanceRunId].join(
          String.fromCharCode(92),
        )
      : path.join(directory, r.instanceRunId + ".sock");
  let status: PrimaryRouterStatus = { kind: "primary", self: record };
  const receiver = vi.fn(async () => ({ kind: "accepted" as const }));
  const endpoint = createRouterProbeEndpoint(record, endpointFor, policy, {
    current: () => status,
    receiver,
    policy: {
      timeoutMs: 500,
      maxAttempts: 2,
      retryDelayMs: 10,
      maxTargetLength: 2048,
      acceptedTtlMs: 60000,
      maxRequests: 10,
    },
  });
  cleanup.push(() => endpoint.close());
  await endpoint.listen();
  return {
    record,
    endpoint,
    receiver,
    address: endpointFor(record),
    setStatus: (s: PrimaryRouterStatus) => {
      status = s;
    },
  };
}
async function exchange(
  address: string,
  chunks: string[],
  halfClose = false,
): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.createConnection(address);
    let text = "";
    const timer = setTimeout(() => socket.destroy(), 1000);
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      text += chunk.toString();
    });
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(text);
    });
    socket.once("connect", async () => {
      for (const chunk of chunks) {
        socket.write(chunk);
        await new Promise((r) => setTimeout(r, 5));
      }
      if (halfClose) socket.end();
    });
  });
}
describe("authenticated endpoint handoff", () => {
  it("receives authenticated handoff from a separate Node test process", async () => {
    const f = await fixture();
    const request = {
      protocolVersion: 1,
      kind: "launchHandoff",
      requestId: createUuidv7(),
      target: "/book/a.md",
      nonce: "b".repeat(64),
    };
    const frame =
      JSON.stringify({
        ...request,
        proof: launchHandoffProof(f.record, request),
      }) + String.fromCharCode(10);
    // A transport test peer, not Pergamum child-launch behavior.
    const script =
      'const net=require("node:net");const socket=net.createConnection(process.argv[1]);const timer=setTimeout(()=>process.exit(2),1000);let reply="";socket.on("connect",()=>socket.write(process.argv[2]));socket.on("data",data=>reply+=data);socket.on("error",()=>process.exit(3));socket.on("end",()=>{clearTimeout(timer);process.stdout.write(reply)});';
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["-e", script, f.address, frame],
      { timeout: 2000 },
    );
    expect(JSON.parse(stdout).disposition).toEqual({ kind: "accepted" });
    expect(f.receiver).toHaveBeenCalledTimes(1);
  });
  it("ACKs accepted ownership once and keeps probes working", async () => {
    const f = await fixture();
    const id = createUuidv7();
    expect(await f.endpoint.probe(f.record)).toBe(true);
    expect(
      await f.endpoint.sendLaunchHandoff(f.record, id, "/book/a.md"),
    ).toEqual({ kind: "accepted" });
    expect(
      await f.endpoint.sendLaunchHandoff(f.record, id, "/book/a.md"),
    ).toEqual({ kind: "accepted" });
    expect(f.receiver).toHaveBeenCalledTimes(1);
    expect(
      await f.endpoint.sendLaunchHandoff(f.record, id, "/book/b.md"),
    ).toEqual({ kind: "rejected", reason: "requestIdConflict" });
    f.setStatus({ kind: "discovering" });
    expect(
      await f.endpoint.sendLaunchHandoff(
        f.record,
        createUuidv7(),
        "/book/b.md",
      ),
    ).toEqual({ kind: "notPrimary" });
    expect(await f.endpoint.probe(f.record)).toBe(true);
  });
  it("rejects invalid authentication and target before sink", async () => {
    const f = await fixture();
    expect(
      await f.endpoint.sendLaunchHandoff(
        { ...f.record, probeSecret: "b".repeat(64) },
        createUuidv7(),
        "/book/a.md",
      ),
    ).toEqual({ kind: "transportFailure" });
    expect(
      await f.endpoint.sendLaunchHandoff(
        f.record,
        createUuidv7(),
        "https://example.com/a.md",
      ),
    ).toEqual({ kind: "rejected", reason: "invalidTarget" });
    expect(f.receiver).not.toHaveBeenCalled();
  });
  it("supports partial frames and rejects extra frames, truncated frames and oversized input", async () => {
    const f = await fixture();
    const req = {
      protocolVersion: 1,
      kind: "launchHandoff",
      requestId: createUuidv7(),
      target: "/book/a.md",
      nonce: "b".repeat(64),
    };
    const frame =
      JSON.stringify({ ...req, proof: launchHandoffProof(f.record, req) }) +
      String.fromCharCode(10);
    const response = await exchange(f.address, [
      frame.slice(0, 20),
      frame.slice(20),
    ]);
    expect(JSON.parse(response).disposition).toEqual({ kind: "accepted" });
    expect(await exchange(f.address, [frame + frame])).toBe("");
    expect(await exchange(f.address, [frame.slice(0, 20)], true)).toBe("");
    expect(
      await exchange(f.address, ["x".repeat(policy.maxFrameBytes + 1)]),
    ).toBe("");
    expect(
      await exchange(f.address, ["not JSON" + String.fromCharCode(10)]),
    ).toBe("");
    expect(f.receiver).toHaveBeenCalledTimes(1);
  });
  it.each([
    { protocolVersion: 2 },
    { kind: "unknown" },
    { requestId: "bad" },
    { target: ["a.md", "b.md"] },
    { extra: true },
  ])("rejects malformed wire payload %j", async (patch) => {
    const f = await fixture();
    const req = {
      protocolVersion: 1,
      kind: "launchHandoff",
      requestId: createUuidv7(),
      target: "/book/a.md",
      nonce: "b".repeat(64),
    };
    expect(
      await exchange(f.address, [
        JSON.stringify({
          ...req,
          proof: launchHandoffProof(f.record, req),
          ...patch,
        }) + String.fromCharCode(10),
      ]),
    ).toBe("");
    expect(f.receiver).not.toHaveBeenCalled();
  });
  it.each(["requestId", "nonce", "instanceRunId", "proof"] as const)(
    "rejects ACK with wrong %s",
    async (field) => {
      const f = await fixture();
      await f.endpoint.close();
      const client = createRouterProbeEndpoint(
        f.record,
        () => f.address,
        policy,
      );
      cleanup.push(() => client.close());
      const server = net.createServer((socket) => {
        socket.on("data", (chunk) => {
          const req = JSON.parse(chunk.toString());
          const disposition = { kind: "accepted" as const };
          const response = {
            protocolVersion: 1,
            kind: "launchHandoffResult",
            requestId: req.requestId,
            nonce: req.nonce,
            instanceRunId: f.record.instanceRunId,
            disposition,
            proof: launchHandoffProof(f.record, req, disposition),
          };
          response[field] =
            field === "nonce" || field === "proof"
              ? "c".repeat(64)
              : createUuidv7();
          socket.end(JSON.stringify(response) + String.fromCharCode(10));
        });
      });
      cleanup.push(
        () => new Promise<void>((resolve) => server.close(() => resolve())),
      );
      await new Promise<void>((resolve) => server.listen(f.address, resolve));
      expect(
        await client.sendLaunchHandoff(f.record, createUuidv7(), "/book/a.md"),
      ).toEqual({ kind: "protocolError" });
    },
  );
  it("production adapter discovers Primary, delivers, and takes over without target wiring", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pg-router-"));
    cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
    const receiver = vi.fn(async () => ({ kind: "accepted" as const }));
    const a = await createRuntimePrimaryRouter({
      userDataPath: directory,
      mode: "development",
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      policy,
      handoffReceiver: receiver,
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
    await a.start();
    await b.start();
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 15));
      await Promise.all([a.refresh(), b.refresh()]);
    }
    expect(a.current().kind).toBe("primary");
    expect(b.current().kind).toBe("secondary");
    expect(
      (
        await b.handoff(
          parseRuntimeLaunch(["Pergamum", "a.md"], { isPackaged: true }),
        )
      ).kind,
    ).toBe("delivered");
    expect(receiver).toHaveBeenCalledTimes(1);
    await a.stop();
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 15));
      await b.refresh();
    }
    expect(b.current().kind).toBe("primary");
  });
});
