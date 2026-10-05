import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUuidv7 } from "../../src/shared/uuidv7";
import { createRouterProbeEndpoint } from "../../src/main/primaryRouterEndpoint";
import {
  createRoutedChildRouter,
  spawnRoutedProcess,
} from "../../src/main/routedChildRouter";

describe("independent child process claim transport", () => {
  it("production spawn adapter receives a claim from an actual separate PID", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "pg-child-claim-"),
    );
    const script = path.join(directory, "claim.cjs");
    // A protocol peer fixture, not a second implementation of application routing.
    // It has no Electron/userData access and exits after its one-shot claim.
    await fs.writeFile(
      script,
      [
        'const net = require("node:net"); const crypto = require("node:crypto");',
        "const m = JSON.parse(process.env.PERGAMUM_ROUTED_CHILD_METADATA);",
        "const target = process.argv.at(-1);",
        'if (process.argv.at(-2) !== "--pergamum-routed-launch=v1") process.exit(2);',
        'const c = {protocolVersion:1,kind:"routedChildClaim",requestId:m.requestId,attemptId:m.attemptId,parentInstanceRunId:m.parentInstanceRunId,childInstanceRunId:process.env.TEST_CHILD_ID,childPid:process.pid,target,nonce:m.nonce};',
        'c.proof = crypto.createHmac("sha256",m.secret).update(JSON.stringify(["request",1,"routedChildClaim",c.requestId,c.attemptId,c.parentInstanceRunId,c.childInstanceRunId,c.childPid,c.target,c.nonce])).digest("hex");',
        "const socket = net.createConnection(m.endpoint);",
        "const timer = setTimeout(() => {socket.destroy();process.exit(3);},5000);",
        'socket.once("connect", () => socket.write(JSON.stringify(c)+String.fromCharCode(10)));',
        'socket.once("data", () => {clearTimeout(timer);socket.destroy();});',
        'socket.once("error", () => {clearTimeout(timer);process.exit(4);});',
      ].join("\n"),
    );
    const self = {
      schemaVersion: 1 as const,
      scope: "a".repeat(64),
      instanceRunId: createUuidv7(),
      pid: process.pid,
      startedAt: 1,
      probeSecret: "b".repeat(64),
    };
    const address =
      process.platform === "win32"
        ? "\\\\.\\pipe\\pg-child-process-" + createUuidv7()
        : path.join(directory, "claim.sock");
    let childPid: number | undefined;
    const router = createRoutedChildRouter({
      parentInstanceRunId: self.instanceRunId,
      endpoint: () => address,
      now: () => Date.now(),
      onClaimed: () => {},
      spawn: (target, metadata) => {
        const child = spawnRoutedProcess({
          executable: process.execPath,
          appPath: script,
          packaged: false,
          target,
          metadata,
          environment: { ...process.env, TEST_CHILD_ID: createUuidv7() },
        });
        childPid = child.pid;
        return child;
      },
    });
    const endpoint = createRouterProbeEndpoint(self, () => address, undefined, {
      current: () => ({ kind: "secondary", primary: self }),
      childClaim: router.receiveClaim,
    });
    await endpoint.listen();
    try {
      expect(
        await router.route({
          requestId: createUuidv7(),
          target: path.join(directory, "日本語 & (chapter).md"),
          receivedAt: 0,
        }),
      ).toEqual({ kind: "claimed" });
      expect(childPid).toBeGreaterThan(0);
      expect(childPid).not.toBe(process.pid);
    } finally {
      router.stop();
      await endpoint.close();
      // Only this test-created temporary directory; no process or userData cleanup.
      if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
          !path.basename(directory).startsWith("pg-child-claim-")) {
        throw new Error("Unexpected test directory.");
      }
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20000);
});
