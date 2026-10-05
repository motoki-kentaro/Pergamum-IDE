import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeLaunchDispatcher } from "../../src/main/runtimeLaunchDispatcher";
import { createRuntimeLaunchQueue } from "../../src/main/runtimeLaunchQueue";
import { parseRuntimeLaunch } from "../../src/main/runtimeLaunchRouting";
import type {
  RuntimeProjectContext,
  RuntimeLocalActionRequest,
} from "../../src/shared/runtimeLaunchAction";
import type { StartupMarkdownRoutingDeps } from "../../src/main/startupMarkdownRouting";

const id = "019a0000-0000-7000-8000-000000000001";
const p = (s: string) => path.resolve(s);
const projectless: RuntimeProjectContext = {
  projectId: null,
  rootPath: null,
  projectFilePath: null,
};
const projectA: RuntimeProjectContext = {
  projectId: "A",
  rootPath: p("A"),
  projectFilePath: p("A/A.pergamum"),
};
function harness(
  spec: {
    dirs?: Record<string, string[]>;
    links?: Record<string, string>;
    context?: RuntimeProjectContext;
  } = {},
) {
  let context = spec.context ?? projectless;
  const dirs = new Map(
    Object.entries(spec.dirs ?? {}).map(([k, v]) => [p(k), v]),
  );
  const links = new Map(
    Object.entries(spec.links ?? {}).map(([k, v]) => [p(k), p(v)]),
  );
  const filesystem: StartupMarkdownRoutingDeps = {
    stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
    realpath: vi.fn(async (file) => links.get(p(file)) ?? p(file)),
    readdir: vi.fn(async (directory) => dirs.get(p(directory)) ?? []),
  };
  const local = vi.fn(async (_request: RuntimeLocalActionRequest) => ({
    kind: "handled" as const,
  }));
  const register = vi.fn((absolute: string) =>
    path.relative(context.rootPath!, absolute).split(path.sep).join("/"),
  );
  const dispatcher = createRuntimeLaunchDispatcher({
    getContext: () => context,
    canDispatch: () => true,
    dispatchLocal: local,
    registerDocument: register,
    filesystem,
    platform: process.platform === "win32" ? "windows" : "linux",
  });
  return {
    dispatcher,
    local,
    register,
    filesystem,
    setContext: (c: RuntimeProjectContext) => {
      context = c;
    },
  };
}
const entry = (target: string, requestId = id) => ({
  requestId,
  target,
  receivedAt: 0,
});
describe("runtime Markdown dispatcher", () => {
  it.each(["note.md", "note.markdown"])(
    "projectless standalone %s uses the External File action",
    async (target) => {
      const h = harness();
      expect(await h.dispatcher.dispatch(entry(target))).toEqual({
        kind: "handled",
      });
      expect(h.local.mock.calls[0][0].action).toEqual({
        kind: "standalone",
        filePath: p(target),
      });
    },
  );
  it("promotes project-owned Markdown without a standalone action", async () => {
    const h = harness({ dirs: { A: ["A.pergamum"] } });
    await h.dispatcher.dispatch(entry("A/chapter.md"));
    expect(h.local.mock.calls[0][0].action).toEqual({
      kind: "promoteProject",
      projectFilePath: p("A/A.pergamum"),
      filePath: p("A/chapter.md"),
    });
  });
  it("uses the Project Document lifecycle for the canonical current locator", async () => {
    const h = harness({ dirs: { A: ["A.pergamum"] }, context: projectA });
    expect(await h.dispatcher.dispatch(entry("A/chapter.md"))).toEqual({
      kind: "handled",
    });
    expect(h.local.mock.calls[0][0].action).toEqual({
      kind: "projectDocument",
      relativePath: "chapter.md",
    });
    expect(h.register).toHaveBeenCalledWith(p("A/chapter.md"));
  });
  it.each(["B/chapter.md", "outside.md", "B/B.pergamum"])(
    "foreign target %s never opens locally",
    async (target) => {
      const h = harness({
        dirs: { A: ["A.pergamum"], B: ["B.pergamum"] },
        context: projectA,
      });
      expect(await h.dispatcher.dispatch(entry(target))).toEqual({
        kind: "requiresNewProcess",
        target,
      });
      expect(h.local).not.toHaveBeenCalled();
      expect(h.register).not.toHaveBeenCalled();
    },
  );
  it("nearest nested Project wins over current root containment", async () => {
    const h = harness({
      dirs: { A: ["A.pergamum"], "A/nested": ["B.pergamum"] },
      context: projectA,
    });
    expect(
      (await h.dispatcher.dispatch(entry("A/nested/chapter.md"))).kind,
    ).toBe("requiresNewProcess");
    expect(h.local).not.toHaveBeenCalled();
  });
  it("different locator at the same root is foreign", async () => {
    const h = harness({ dirs: { A: ["B.pergamum"] }, context: projectA });
    expect((await h.dispatcher.dispatch(entry("A/chapter.md"))).kind).toBe(
      "requiresNewProcess",
    );
  });
  it("canonical locator aliases are the same Project", async () => {
    const h = harness({
      dirs: { A: ["alias.pergamum"] },
      links: { "A/alias.pergamum": "A/A.pergamum" },
      context: projectA,
    });
    expect((await h.dispatcher.dispatch(entry("A/chapter.md"))).kind).toBe(
      "handled",
    );
  });
  it("lexically inside but canonically outside is foreign", async () => {
    const h = harness({
      dirs: { A: ["A.pergamum"] },
      links: { "A/link.md": "outside/chapter.md" },
      context: projectA,
    });
    expect((await h.dispatcher.dispatch(entry("A/link.md"))).kind).toBe(
      "requiresNewProcess",
    );
    expect(h.local).not.toHaveBeenCalled();
  });
  it("lexically outside but canonically inside uses the Project Document lifecycle", async () => {
    const h = harness({
      dirs: { A: ["A.pergamum"] },
      links: { "link.md": "A/chapter.md" },
      context: projectA,
    });
    expect((await h.dispatcher.dispatch(entry("link.md"))).kind).toBe(
      "handled",
    );
    expect(h.local.mock.calls[0][0].action).toEqual({
      kind: "projectDocument",
      relativePath: "chapter.md",
    });
  });
  it.each(["note.txt", "note.mkd", "note"])(
    "delegates unsupported %s to the existing classifier",
    async (target) => {
      const h = harness();
      h.local.mockImplementation(async () => ({ kind: "rejected" }) as never);
      expect(await h.dispatcher.dispatch(entry(target))).toEqual({
        kind: "rejected",
      });
      expect(h.filesystem.stat).toHaveBeenCalled();
      expect(h.local.mock.calls[0][0].action).toEqual({
        kind: "reject",
        reason: "unsupportedExtension",
      });
    },
  );
  it.each(["https://example.com/a.md", "custom:foo.md"])(
    "rejects URL-like %s",
    async (target) => {
      const h = harness();
      await h.dispatcher.dispatch(entry(target));
      expect(h.local.mock.calls[0][0].action).toEqual({
        kind: "reject",
        reason: "urlLikeInput",
      });
      expect(h.filesystem.stat).not.toHaveBeenCalled();
    },
  );
  it("rejects ambiguous nearest root without prioritizing current locator", async () => {
    const h = harness({
      dirs: { A: ["A.pergamum", "other.pergamum"] },
      context: projectA,
    });
    await h.dispatcher.dispatch(entry("A/chapter.md"));
    expect(h.local.mock.calls[0][0].action).toEqual({
      kind: "reject",
      reason: "ambiguousProject",
    });
  });
  it("checks context after classification", async () => {
    const h = harness();
    vi.mocked(h.filesystem.stat).mockImplementation(async () => {
      h.setContext(projectA);
      return { isFile: () => true, isDirectory: () => false };
    });
    expect(await h.dispatcher.dispatch(entry("note.md"))).toEqual({
      kind: "retryLater",
    });
    expect(h.local).not.toHaveBeenCalled();
  });
  it("checks context after canonical locator resolution", async () => {
    const h = harness({ dirs: { A: ["A.pergamum"] }, context: projectA });
    vi.mocked(h.filesystem.realpath).mockImplementation(async (file) => {
      if (file === projectA.projectFilePath)
        h.setContext({ ...projectA, projectId: "replacement" });
      return p(file);
    });
    expect((await h.dispatcher.dispatch(entry("A/chapter.md"))).kind).toBe(
      "retryLater",
    );
    expect(h.local).not.toHaveBeenCalled();
  });
  it("checks context immediately before issuing a local action", async () => {
    const h = harness({ dirs: { A: ["A.pergamum"] }, context: projectA });
    h.register.mockImplementation(() => {
      h.setContext({ ...projectA, projectId: "changed" });
      return "chapter.md";
    });
    expect((await h.dispatcher.dispatch(entry("A/chapter.md"))).kind).toBe(
      "retryLater",
    );
    expect(h.local).not.toHaveBeenCalled();
  });
  it("repeats the same action/context after a lost promotion ACK", async () => {
    const h = harness({ dirs: { A: ["A.pergamum"] } });
    h.local.mockImplementationOnce(async () => {
      h.setContext(projectA);
      return { kind: "retryLater" } as never;
    });
    await h.dispatcher.dispatch(entry("A/chapter.md"));
    await h.dispatcher.dispatch(entry("A/chapter.md"));
    expect(h.local.mock.calls[1][0]).toEqual(h.local.mock.calls[0][0]);
  });
  it.each(["retryLater", "requiresNewProcess", "handled", "rejected"])(
    "queue ownership for %s",
    async (resultKind) => {
      const h = harness();
      h.local.mockImplementation(
        async () =>
          ({
            kind:
              resultKind === "requiresNewProcess" ? "retryLater" : resultKind,
          }) as never,
      );
      const target =
        resultKind === "requiresNewProcess" ? "A.pergamum" : "note.md";
      const launch = parseRuntimeLaunch(["Pergamum", target], {
        isPackaged: true,
      });
      if (launch.kind !== "launch") throw new Error("fixture");
      const queue = createRuntimeLaunchQueue({ now: () => 0 });
      queue.enqueue({ requestId: id, target, launch });
      await queue.markReady(h.dispatcher.sink);
      expect(queue.current().pending).toHaveLength(
        ["handled", "rejected"].includes(resultKind) ? 0 : 1,
      );
    },
  );
});
