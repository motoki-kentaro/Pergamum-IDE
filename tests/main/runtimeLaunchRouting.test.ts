import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRuntimeLaunch, decideRuntimeLaunchRouting, ROUTED_LAUNCH_MARKER, type RuntimeRoutingContext } from "../../src/main/runtimeLaunchRouting";
import { extractColdStartLaunchTarget } from "../../src/main/startupLaunchTarget";
import { classifyStartupMarkdownTarget } from "../../src/main/startupMarkdownRouting";

const packaged = { isPackaged: true };
const primary: RuntimeRoutingContext = { isPrimary: true, project: { kind: "projectless" } };
const secondary: RuntimeRoutingContext = { ...primary, isPrimary: false };
const parse = (target: string, internal = false) => parseRuntimeLaunch(
  ["Pergamum.exe", ...(internal ? [ROUTED_LAUNCH_MARKER] : []), target], packaged
);
const owned = (markdownOwnership: "current" | "foreign" | "unknown" | "unsafe"): RuntimeRoutingContext => ({
  isPrimary: true, project: { kind: "project", markdownOwnership }
});

describe("runtime launch parsing", () => {
  it("normalizes a project target using the cold-start extractor", () => {
    expect(parse("A.pergamum")).toEqual({ kind: "launch", origin: "external", target: { kind: "pergamum", filePath: path.resolve("A.pergamum") } });
  });
  it.each(["chapter.md", "chapter.markdown", "notes.txt", "a.mkd", "a.mdown", "extensionless", "A.PERGAMUM", "C:\\Book\\a.md", "\\\\server\\share\\a.md", "/book/a.md"])("shares cold-start candidate extraction for %s", (target) => {
    const argv = ["Pergamum.exe", target];
    expect(parseRuntimeLaunch(argv, packaged)).toEqual({ kind: "launch", origin: "external", target: extractColdStartLaunchTarget(argv, packaged) });
  });
  it.each(["https://example.com/A.pergamum", "https://example.com/a.md", "mailto:chapter.md", "about:blank"])("rejects URL-like input before path normalization: %s", (target) => {
    expect(parse(target)).toEqual({ kind: "rejected", reason: "urlLikeInput" });
    expect(parse(target, true)).toEqual({ kind: "rejected", reason: "urlLikeInput" });
  });
  it.each([
    [[], "noTarget"],
    [["--debug", " "], "noTarget"],
    [["a.md", "b.md"], "multipleTargets"],
    [[ROUTED_LAUNCH_MARKER], "missingRoutedTarget"],
    [["--pergamum-routed-launch"], "missingMarkerPayload"],
    [["--pergamum-routed-launch=", "a.md"], "missingMarkerPayload"],
    [["--pergamum-routed-launch=v2", "a.md"], "malformedMarker"],
    [["--pergamum-routed-launch-broken", "a.md"], "malformedMarker"],
    [["--pergamum-routed-launch", "v1", "a.md"], "missingMarkerPayload"],
    [[ROUTED_LAUNCH_MARKER, ROUTED_LAUNCH_MARKER, "a.md"], "duplicateMarker"],
    [[ROUTED_LAUNCH_MARKER, "--pergamum-routed-launch=bad", "a.md"], "duplicateMarker"],
    [[ROUTED_LAUNCH_MARKER, "a.md", "b.md"], "multipleTargets"]
  ] as const)("rejects malformed argv %j", (args, reason) => {
    expect(parseRuntimeLaunch(["Pergamum.exe", ...args], packaged)).toEqual({ kind: "rejected", reason });
  });
  it("recognizes an internal marker before option filtering, in either position", () => {
    for (const args of [[ROUTED_LAUNCH_MARKER, "a.md"], ["a.md", ROUTED_LAUNCH_MARKER, "--debug"]]) {
      expect(parseRuntimeLaunch(["Pergamum.exe", ...args], packaged)).toEqual({ kind: "launch", origin: "routedChild", target: { kind: "markdown", rawInput: "a.md" } });
    }
  });
  it("preserves development argv policy and validates even a marker at the skipped slot", () => {
    expect(parseRuntimeLaunch(["electron", ".", ROUTED_LAUNCH_MARKER, "a.md"], { isPackaged: false })).toEqual(parse("a.md", true));
    expect(parseRuntimeLaunch(["electron", "A.pergamum"], { isPackaged: false })).toEqual(parse("A.pergamum"));
    expect(parseRuntimeLaunch(["electron", "--pergamum-routed-launch=bad", "a.md"], { isPackaged: false })).toEqual({ kind: "rejected", reason: "malformedMarker" });
  });
  it("delegates final unsupportedExtension to the existing classifier", async () => {
    const launch = parse("notes.txt");
    expect(launch).toEqual({ kind: "launch", origin: "external", target: { kind: "markdown", rawInput: "notes.txt" } });
    const classification = await classifyStartupMarkdownTarget("notes.txt", {
      stat: async () => ({ isFile: () => true, isDirectory: () => false }),
      realpath: async () => { throw new Error("unsupported target must not reach realpath"); },
      readdir: async () => { throw new Error("unsupported target must not reach discovery"); }
    });
    expect(classification.kind).toBe("rejected");
    expect(decideRuntimeLaunchRouting(launch, primary, classification)).toEqual({ kind: "reject", reason: "unsupportedExtension" });
  });
});

describe("pure runtime routing decisions", () => {
  it.each(["A.pergamum", "a.md", "notes.txt"])("hands external %s on secondary to Primary", (target) => {
    expect(decideRuntimeLaunchRouting(parse(target), secondary)).toEqual({ kind: "handoffToPrimary" });
  });
  it.each(["A.pergamum", "a.md"])("internally routed %s never re-handoffs or re-spawns", (target) => {
    for (const context of [primary, secondary, owned("current"), owned("foreign"), owned("unknown")]) {
      expect(decideRuntimeLaunchRouting(parse(target, true), context)).toEqual({ kind: "handleLocally", route: "coldStart" });
    }
  });
  it("spawns for runtime project targets regardless of Primary project context", () => {
    for (const context of [primary, owned("current")]) {
      expect(decideRuntimeLaunchRouting(parse("A.pergamum"), context)).toEqual({ kind: "spawnProcess" });
    }
  });
  it("requires safe Markdown classification in a projectless Primary", () => {
    expect(decideRuntimeLaunchRouting(parse("a.md"), primary)).toEqual({ kind: "handleLocally", route: "classifyMarkdown" });
  });
  it("restricts current-project handling to Project Documents", () => {
    expect(decideRuntimeLaunchRouting(parse("a.md"), owned("current"))).toEqual({ kind: "handleLocally", route: "projectDocument" });
  });
  it("spawns for safely foreign Markdown", () => {
    expect(decideRuntimeLaunchRouting(parse("a.md"), owned("foreign"))).toEqual({ kind: "spawnProcess" });
  });
  it("does not guess unknown or unsafe ownership", () => {
    expect(decideRuntimeLaunchRouting(parse("a.md"), owned("unknown"))).toEqual({ kind: "evaluateLocally", requirement: "currentProjectOwnership" });
    expect(decideRuntimeLaunchRouting(parse("a.md"), owned("unsafe"))).toEqual({ kind: "reject", reason: "unsafeOwnership" });
  });
  it("propagates parser rejection in every process disposition", () => {
    for (const context of [primary, secondary]) {
      expect(decideRuntimeLaunchRouting(parse("https://example.com/a.md"), context)).toEqual({ kind: "reject", reason: "urlLikeInput" });
    }
  });
  it.each(["ambiguousProject", "discoveryFailed", "notFound", "unsupportedExtension"] as const)("preserves classifier safe failure %s even for routed children", (reason) => {
    for (const internal of [false, true]) {
      expect(decideRuntimeLaunchRouting(parse("a.md", internal), primary, { kind: "rejected", filePath: "a.md", reason })).toEqual({ kind: "reject", reason });
    }
  });
  it("project-owned classification never grants standalone writable handling", () => {
    const decision = decideRuntimeLaunchRouting(parse("a.md"), primary, { kind: "enclosingProject", filePath: "/book/a.md", projectFilePath: "/book/A.pergamum", projectRootPath: "/book" });
    expect(decision).toEqual({ kind: "handleLocally", route: "classifyMarkdown" });
  });
});
