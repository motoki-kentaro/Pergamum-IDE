import { describe, expect, it, vi } from "vitest";
import { createRuntimeMarkdownLocalReceiver } from "../../src/renderer/runtimeMarkdownLocalRouting";
import type {
  RuntimeLocalActionRequest,
  RuntimeLocalActionResult,
} from "../../src/shared/runtimeLaunchAction";
const request: RuntimeLocalActionRequest = {
  requestId: "019a0000-0000-7000-8000-000000000001",
  target: "/chapter.md",
  expectedContext: { projectId: null, rootPath: null, projectFilePath: null },
  action: { kind: "standalone", filePath: "/chapter.md" },
};
describe("Renderer lifetime local-action deduplication", () => {
  it.each(["standalone", "projectDocument", "promoteProject", "reject"])(
    "shares in-flight and completed %s actions",
    async (kind) => {
      let resolve!: (r: RuntimeLocalActionResult) => void;
      const handler = vi.fn(
        () =>
          new Promise<RuntimeLocalActionResult>((r) => {
            resolve = r;
          }),
      );
      const receiver = createRuntimeMarkdownLocalReceiver({ handle: handler });
      const action =
        kind === "standalone"
          ? request.action
          : kind === "projectDocument"
            ? { kind, relativePath: "chapter.md" }
            : kind === "promoteProject"
              ? {
                  kind,
                  projectFilePath: "/A.pergamum",
                  filePath: "/chapter.md",
                }
              : { kind, reason: "ambiguousProject" };
      const input = { ...request, action } as RuntimeLocalActionRequest;
      const a = receiver.receive(input),
        b = receiver.receive(input);
      await Promise.resolve();
      expect(handler).toHaveBeenCalledTimes(1);
      resolve({ kind: kind === "reject" ? "rejected" : "handled" });
      expect(await a).toEqual(await b);
      expect(await receiver.receive(input)).toEqual(await a);
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { ...request, target: "/different.md" },
    { ...request, action: { kind: "reject", reason: "notFound" } },
    {
      ...request,
      expectedContext: {
        projectId: "A",
        rootPath: "/A",
        projectFilePath: "/A/A.pergamum",
      },
    },
  ])(
    "rejects same id with a different target, action or context",
    async (other) => {
      const handler = vi.fn(async () => ({ kind: "handled" as const }));
      const receiver = createRuntimeMarkdownLocalReceiver({ handle: handler });
      await receiver.receive(request);
      expect(
        await receiver.receive(other as RuntimeLocalActionRequest),
      ).toEqual({ kind: "conflict" });
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );
  it("permits retry when a lifecycle barrier refused ownership", async () => {
    const handler = vi.fn(async (): Promise<RuntimeLocalActionResult> => ({
      kind: "retryLater",
    }));
    const receiver = createRuntimeMarkdownLocalReceiver({ handle: handler });
    await receiver.receive(request);
    handler.mockResolvedValue({ kind: "handled" });
    expect(await receiver.receive(request)).toEqual({ kind: "handled" });
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("retains unacknowledged successes at capacity and admits work after Main releases", async () => {
    const handler = vi.fn(async () => ({ kind: "handled" as const }));
    const receiver = createRuntimeMarkdownLocalReceiver({
      handle: handler,
      policy: { maxRememberedActions: 1 },
    });
    await receiver.receive(request);
    const next = {
      ...request,
      requestId: "019a0000-0000-7000-8000-000000000002",
    };
    expect(await receiver.receive(next)).toEqual({ kind: "retryLater" });
    expect(await receiver.receive(request)).toEqual({ kind: "handled" });
    receiver.release(request.requestId);
    await Promise.resolve();
    expect(await receiver.receive(next)).toEqual({ kind: "handled" });
  });
  it("does not repeat an action when its handler throws after an effect may have started", async () => {
    const handler = vi.fn(async () => {
      throw new Error("response lost");
    });
    const receiver = createRuntimeMarkdownLocalReceiver({ handle: handler });
    expect(await receiver.receive(request)).toEqual({ kind: "retryLater" });
    expect(await receiver.receive(request)).toEqual({ kind: "retryLater" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("still rejects changed action/context after a transient refusal", async () => {
    const handler = vi.fn(async () => ({ kind: "retryLater" as const }));
    const receiver = createRuntimeMarkdownLocalReceiver({ handle: handler });
    await receiver.receive(request);
    expect(await receiver.receive({ ...request, target: "/other.md" })).toEqual(
      { kind: "conflict" },
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
