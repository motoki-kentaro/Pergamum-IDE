import { describe, expect, it } from "vitest";
import {
  isRuntimeLocalActionRequest,
  isRuntimeLocalActionResponse,
  runtimeActionFingerprint,
  type RuntimeLocalActionRequest,
} from "../../src/shared/runtimeLaunchAction";
const request: RuntimeLocalActionRequest = {
  requestId: "019a0000-0000-7000-8000-000000000001",
  target: "/note.md",
  expectedContext: { projectId: null, rootPath: null, projectFilePath: null },
  action: { kind: "standalone", filePath: "/note.md" },
};
describe("runtime local-action boundary", () => {
  it("validates minimal request and response", () => {
    expect(isRuntimeLocalActionRequest(request)).toBe(true);
    expect(
      isRuntimeLocalActionResponse({
        requestId: request.requestId,
        result: { kind: "handled" },
      }),
    ).toBe(true);
  });
  it.each([
    { ...request, requestId: "invalid" },
    { ...request, target: "" },
    { ...request, secret: "unexpected" },
    { ...request, action: { kind: "spawn", filePath: "/note.md" } },
    {
      ...request,
      expectedContext: {
        projectId: "A",
        rootPath: null,
        projectFilePath: null,
      },
    },
    {
      ...request,
      expectedContext: {
        projectId: "A",
        rootPath: "/A",
        projectFilePath: "/A/A.pergamum",
      },
    },
    { ...request, action: { kind: "reject", reason: "unknown" } },
    {
      ...request,
      action: { kind: "projectDocument", relativePath: "../outside.md" },
      expectedContext: {
        projectId: "A",
        rootPath: "/A",
        projectFilePath: "/A/A.pergamum",
      },
    },
  ])("rejects malformed action payload", (value) =>
    expect(isRuntimeLocalActionRequest(value)).toBe(false),
  );
  it("fingerprint does not depend on JSON property order", () => {
    const reordered: RuntimeLocalActionRequest = {
      action: { filePath: "/note.md", kind: "standalone" },
      expectedContext: {
        projectFilePath: null,
        rootPath: null,
        projectId: null,
      },
      target: request.target,
      requestId: request.requestId,
    };
    expect(runtimeActionFingerprint(request)).toBe(
      runtimeActionFingerprint(reordered),
    );
  });
  it("rejects malformed result", () => {
    expect(
      isRuntimeLocalActionResponse({
        requestId: request.requestId,
        result: { kind: "accepted" },
      }),
    ).toBe(false);
    expect(
      isRuntimeLocalActionResponse({
        requestId: request.requestId,
        result: { kind: "handled", unsafe: true },
      }),
    ).toBe(false);
  });
});
