// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderMermaidPlaceholder } from "../../src/renderer/preview/mermaidPreviewPlaceholder";
import {
  renderMermaidDiagramsInContainer,
  withMermaidMathLabelSupport,
  type MermaidPreviewMessages,
  type MermaidRenderFn,
  type MermaidRenderSuccess
} from "../../src/renderer/preview/markdownMermaidRendering";

const messages: MermaidPreviewMessages = {
  emptyMessage: "Mermaid diagram is empty.",
  errorMessage: "Failed to render Mermaid diagram.",
  errorHint: "Check the diagram syntax.",
  showDetailsLabel: "Show details"
};

function containerWithPlaceholders(sources: readonly string[]): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = sources
    .map((source) => renderMermaidPlaceholder(source))
    .join("");
  document.body.appendChild(container);
  return container;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("renderMermaidDiagramsInContainer (#564)", () => {
  it("replaces the placeholder with the rendered SVG on success", async () => {
    const container = containerWithPlaceholders(["graph TD\n  A --> B"]);
    const renderFn: MermaidRenderFn = vi.fn(async (id, source) => ({
      svg: `<svg data-id="${id}" data-source-length="${source.length}"></svg>`
    }));

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);
    await flushMicrotasks();

    const diagram = container.querySelector(".markdownMermaidDiagram svg");
    expect(diagram).not.toBeNull();
    expect(diagram?.getAttribute("data-id")).toBe("pergamum-mermaid-1-0");
    expect(container.querySelector(".markdownMermaidSource")).toBeNull();
  });

  it("calls bindFunctions with the inserted diagram element when provided", async () => {
    const container = containerWithPlaceholders(["graph TD\n  A --> B"]);
    const bindFunctions = vi.fn();
    const renderFn: MermaidRenderFn = vi.fn(async () => ({
      svg: "<svg></svg>",
      bindFunctions
    }));

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);
    await flushMicrotasks();

    expect(bindFunctions).toHaveBeenCalledTimes(1);
    expect(bindFunctions.mock.calls[0][0]).toBe(
      container.querySelector(".markdownMermaidDiagram")
    );
  });

  it("shows an inline error card when rendering fails, with escaped message and source", async () => {
    const container = containerWithPlaceholders(["A -->\n<script>bad</script>"]);
    const renderFn: MermaidRenderFn = vi.fn(async () => {
      throw new Error("Parse error on line 1: <img onerror=alert(1)>");
    });

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);
    await flushMicrotasks();

    const errorCard = container.querySelector(".markdownMermaidError");
    expect(errorCard).not.toBeNull();
    expect(errorCard?.querySelector(".markdownMermaidErrorMessage")?.textContent).toBe(
      messages.errorMessage
    );
    expect(errorCard?.querySelector(".markdownMermaidErrorHint")?.textContent).toBe(
      messages.errorHint
    );
    expect(
      errorCard?.querySelector(".markdownMermaidErrorReason")?.textContent
    ).toContain("<img onerror=alert(1)>");
    expect(
      errorCard?.querySelector(".markdownMermaidErrorSource")?.textContent
    ).toContain("<script>bad</script>");
    // Never present as live, unescaped markup.
    expect(container.innerHTML).not.toContain("<img onerror=alert(1)>");
    expect(container.innerHTML).not.toContain("<script>bad</script>");
  });

  it("shows the empty message for an empty Mermaid block, without calling render", async () => {
    const container = containerWithPlaceholders([""]);
    const renderFn: MermaidRenderFn = vi.fn();

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);
    await flushMicrotasks();

    expect(renderFn).not.toHaveBeenCalled();
    expect(container.querySelector(".markdownMermaidEmpty")?.textContent).toBe(
      messages.emptyMessage
    );
  });

  it("shows the empty message for a whitespace-only Mermaid block", async () => {
    const container = containerWithPlaceholders(["   \n  \n"]);
    const renderFn: MermaidRenderFn = vi.fn();

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);
    await flushMicrotasks();

    expect(renderFn).not.toHaveBeenCalled();
    expect(container.querySelector(".markdownMermaidEmpty")).not.toBeNull();
  });

  it("ignores a stale success result once the container has been replaced", async () => {
    const container = containerWithPlaceholders(["graph TD\n  A --> B"]);
    let resolveRender: (value: MermaidRenderSuccess) => void;
    const renderFn: MermaidRenderFn = vi.fn(
      () =>
        new Promise<MermaidRenderSuccess>((resolve) => {
          resolveRender = resolve;
        })
    );

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);

    // A newer preview commit replaces the entire subtree before the render settles.
    container.innerHTML = "<p>replaced by a newer render</p>";

    resolveRender!({ svg: "<svg>late</svg>" });
    await flushMicrotasks();

    expect(container.innerHTML).not.toContain("late");
    expect(container.textContent).toBe("replaced by a newer render");
  });

  it("ignores a stale error result once the container has been replaced", async () => {
    const container = containerWithPlaceholders(["graph TD\n  A --> B"]);
    let rejectRender: (error: Error) => void;
    const renderFn: MermaidRenderFn = vi.fn(
      () =>
        new Promise<MermaidRenderSuccess>((_resolve, reject) => {
          rejectRender = reject;
        })
    );

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);

    container.innerHTML = "<p>replaced by a newer render</p>";

    rejectRender!(new Error("late failure"));
    await flushMicrotasks();

    expect(container.innerHTML).not.toContain("markdownMermaidError");
    expect(container.textContent).toBe("replaced by a newer render");
  });

  it("assigns distinct, index-based diagram ids for multiple blocks in one container", async () => {
    const container = containerWithPlaceholders([
      "graph TD\n  A --> B",
      "graph TD\n  C --> D"
    ]);
    const seenIds: string[] = [];
    const renderFn: MermaidRenderFn = vi.fn(async (id) => {
      seenIds.push(id);
      return { svg: `<svg data-id="${id}"></svg>` };
    });

    renderMermaidDiagramsInContainer(container, 7, messages, renderFn);
    await flushMicrotasks();

    expect(seenIds).toEqual([
      "pergamum-mermaid-7-0",
      "pergamum-mermaid-7-1"
    ]);
  });

  it("does nothing when the container has no Mermaid placeholders", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>no diagrams here</p>";
    const renderFn: MermaidRenderFn = vi.fn();

    renderMermaidDiagramsInContainer(container, 1, messages, renderFn);
    await flushMicrotasks();

    expect(renderFn).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("<p>no diagrams here</p>");
  });
});

describe("Mermaid tooltip suppression styles contract (#564 / #716)", () => {
  const stylesSource = readFileSync("src/renderer/styles.css", "utf8");

  function ruleBody(selector: string): string {
    const selectorIndex = stylesSource.indexOf(`${selector} {`);
    expect(selectorIndex).toBeGreaterThan(-1);
    const closeIndex = stylesSource.indexOf("}", selectorIndex);
    return stylesSource.slice(selectorIndex, closeIndex);
  }

  it("suppresses body-level Mermaid tooltip with display: none !important to prevent global window scrollbars", () => {
    const tooltipRule = ruleBody("body > .mermaidTooltip");
    expect(tooltipRule).toContain("display: none !important;");
  });

  it("does not apply overflow: hidden to body to sweep tooltip leaks under the rug", () => {
    const bodyIndex = stylesSource.indexOf("body {");
    if (bodyIndex !== -1) {
      const closeIndex = stylesSource.indexOf("}", bodyIndex);
      const bodyRule = stylesSource.slice(bodyIndex, closeIndex);
      expect(bodyRule).not.toContain("overflow: hidden");
    }
  });
});

/**
 * #743: Mermaid renders `$$...$$` labels with KaTeX — on its HTML-label path
 * only, which `withMermaidMathLabelSupport` turns on per diagram — as
 * MathML-only output on Chromium. A real `mermaid.render()` cannot be
 * exercised here: under happy-dom it resolves with an empty SVG (no layout /
 * measurement), so the end-to-end label rendering is a PO dogfood item. What
 * this pins instead is what the `overrides.katex` entry must guarantee:
 * Mermaid resolves the same KaTeX package Pergamum uses, and that KaTeX
 * accepts Mermaid's own call shape.
 */
describe("withMermaidMathLabelSupport (#743)", () => {
  const directive = '%%{init: {"htmlLabels": true}}%%\n';

  it("leaves a diagram without $$...$$ labels untouched (SVG-text labels stay)", () => {
    const source = 'flowchart LR\n  A["<b>bold</b> $5"] --> B["plain"]';

    expect(withMermaidMathLabelSupport(source)).toBe(source);
  });

  it("turns on HTML labels for a diagram whose labels contain $$...$$ math", () => {
    const source = 'flowchart LR\n  A["$$x^2$$"] --> B["$$\\frac{a}{b}$$"]';

    expect(withMermaidMathLabelSupport(source)).toBe(`${directive}${source}`);
  });

  it("keeps front matter first and puts the directive right after it", () => {
    const frontMatter = "---\ntitle: T\n---\n";
    const body = 'flowchart LR\n  A["$$x^2$$"] --> B';

    expect(withMermaidMathLabelSupport(`${frontMatter}${body}`)).toBe(
      `${frontMatter}${directive}${body}`
    );
  });

  it("never touches securityLevel or any other setting", () => {
    const result = withMermaidMathLabelSupport('flowchart LR\n  A["$$x$$"]');

    expect(result).not.toContain("securityLevel");
    expect(result.match(/%%\{init:/g)).toHaveLength(1);
  });
});

describe("Mermaid math labels share Pergamum's KaTeX (#743)", () => {
  const projectRequire = createRequire(join(process.cwd(), "package.json"));
  const mermaidRequire = createRequire(
    join(process.cwd(), "node_modules/mermaid/package.json")
  );

  it("resolves the same katex package from mermaid as from Pergamum", () => {
    const projectKatex = projectRequire.resolve("katex/package.json");
    const mermaidKatex = mermaidRequire.resolve("katex/package.json");
    const version = (JSON.parse(readFileSync(projectKatex, "utf8")) as { version: string })
      .version;

    expect(mermaidKatex).toBe(projectKatex);
    expect(version).toMatch(/^0\.19\./);
  });

  it.each([
    ["x^2", "<msup>"],
    ["\\frac{a}{b}", "<mfrac>"]
  ])(
    "renders the label $$%s$$ to MathML with Mermaid's KaTeX options",
    async (latex, expectedElement) => {
      const { default: katex } = await import("katex");

      // Same options Mermaid passes for MathML-capable environments.
      const html = katex.renderToString(latex, {
        throwOnError: true,
        displayMode: true,
        output: "mathml"
      });

      expect(html).toContain("<math");
      expect(html).toContain(expectedElement);
      expect(html).not.toContain("katex-html");
      expect(html).not.toContain("katex-error");
    }
  );
});
