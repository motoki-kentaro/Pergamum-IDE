import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markdownPreviewRenderer } from "../../src/renderer/preview/markdownPreviewRenderer";
import { renderMarkdownStaticExport } from "../../src/renderer/export/markdownStaticExportRenderer";
import { generateCombinedHtml } from "../../src/renderer/exportHtml";
import type { ExportAssembly } from "../../src/renderer/exportTypes";
import {
  PAGE_BREAK_MARKUP,
  isPageBreakDirectiveSource,
  standaloneCommentContent
} from "../../src/renderer/preview/markdownComment";

const preview = (md: string, renderer: "markdown" | "narouHorizontal" = "markdown") =>
  markdownPreviewRenderer.render(md, { previewRenderer: renderer });
const exported = (md: string) =>
  markdownPreviewRenderer.render(md, {
    previewRenderer: "markdown",
    pageBreakOutput: "element"
  });

const PAGEBREAK_ELEMENT = '<div class="pergamum-pagebreak" aria-hidden="true"></div>';

describe("standalone Markdown comments (#733)", () => {
  it("renders nothing for a standalone comment (no visible element)", () => {
    const html = preview("一行目。\n\n<!-- ここは作者用メモ -->\n\n二行目。");

    expect(html).not.toContain("作者用メモ");
    expect(html).not.toContain("<!--");
    expect(html).toBe('<p data-source-line="1">一行目。</p>\n<p data-source-line="5">二行目。</p>\n');
  });

  it("does not emit the comment in static export either (not even as an HTML comment)", () => {
    const html = exported("A\n\n<!-- memo -->\n\nB");

    expect(html).not.toContain("memo");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("pergamum-pagebreak");
  });

  it("allows trailing whitespace and minor (<4) indentation", () => {
    expect(preview("<!-- a -->   \n")).toBe("");
    expect(preview("  <!-- a -->\n")).toBe("");
    expect(preview("   <!-- a -->\n")).toBe("");
  });

  it("is not a comment inline, in code spans, fences or indented code", () => {
    expect(preview("text <!-- memo --> text")).toContain("&lt;!-- memo --&gt;");
    expect(preview("`<!-- pagebreak -->`")).toContain(
      "<code>&lt;!-- pagebreak --&gt;</code>"
    );
    expect(preview("本文 <!-- pagebreak -->")).toContain("&lt;!-- pagebreak --&gt;");
    expect(preview("```text\n<!-- pagebreak -->\n```")).toContain(
      "&lt;!-- pagebreak --&gt;"
    );
    expect(preview("    <!-- pagebreak -->")).toContain("&lt;!-- pagebreak --&gt;");
    expect(exported("```text\n<!-- pagebreak -->\n```")).not.toContain(
      "pergamum-pagebreak"
    );
    expect(exported("    <!-- pagebreak -->")).not.toContain("pergamum-pagebreak");
    expect(exported("`<!-- pagebreak -->`")).not.toContain("pergamum-pagebreak");
  });

  it("does not extend to multi-line comments", () => {
    const html = preview("<!--\nmemo\n-->");

    expect(html).toContain("&lt;!--");
    expect(html).toContain("memo");
  });

  it("keeps html: false — raw HTML stays escaped", () => {
    const html = preview(
      "<div>foo</div>\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"
    );

    expect(html).not.toContain("<div>foo</div>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("is shared with the other markdown-it based targets", () => {
    expect(preview("<!-- memo -->", "narouHorizontal")).toBe("");
  });

  it("recognition helper", () => {
    expect(standaloneCommentContent("<!-- memo -->")).toBe(" memo ");
    expect(standaloneCommentContent("a <!-- memo -->")).toBeNull();
    expect(standaloneCommentContent("<!-- a --> b")).toBeNull();
    expect(isPageBreakDirectiveSource(PAGE_BREAK_MARKUP)).toBe(true);
    expect(isPageBreakDirectiveSource("<!-- PageBreak -->")).toBe(false);
    expect(isPageBreakDirectiveSource("<!-- memo -->")).toBe(false);
  });
});

describe("<!-- pagebreak --> (#733)", () => {
  it("renders nothing in Preview", () => {
    expect(preview("A\n\n<!-- pagebreak -->\n\nB")).not.toContain("pagebreak");
  });

  it("becomes the page-break element in static export, in source order", () => {
    const html = exported("A\n\n<!-- pagebreak -->\n\nB");

    expect(html.indexOf(">A<")).toBeLessThan(html.indexOf(PAGEBREAK_ELEMENT));
    expect(html.indexOf(PAGEBREAK_ELEMENT)).toBeLessThan(html.indexOf(">B<"));
    expect(html.match(/pergamum-pagebreak/g)).toHaveLength(1);
  });

  it("handles document start, document end and consecutive directives without dropping any", () => {
    expect(exported("<!-- pagebreak -->\n\nA").startsWith(PAGEBREAK_ELEMENT)).toBe(true);
    expect(exported("A\n\n<!-- pagebreak -->").trimEnd().endsWith(PAGEBREAK_ELEMENT)).toBe(true);
    expect(
      exported("A\n\n<!-- pagebreak -->\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\nB")
        .match(/pergamum-pagebreak/g)
    ).toHaveLength(3);
  });

  it("static export ships the page-break CSS and the element end to end", async () => {
    const result = await renderMarkdownStaticExport({
      markdown: "A\n\n<!-- pagebreak -->\n\n<!-- memo -->\n\nB",
      imageResolutionContext: { kind: "projectRoot" },
      imageAssetFolderName: "assets",
      mermaidMessages: {
        emptyMessage: "",
        errorMessage: "",
        errorHint: "",
        showDetailsLabel: ""
      }
    });

    expect(result.html).toContain(PAGEBREAK_ELEMENT);
    expect(result.html).not.toContain("memo");
    expect(result.exportCss).toContain(".pergamum-pagebreak");
    expect(result.exportCss).toContain("break-before: page;");
    expect(result.exportCss).toContain("page-break-before: always;");
  });
});

describe("source-line mapping survives hidden comments (#733)", () => {
  it("keeps the following block's data-source-line", () => {
    expect(preview("一行目\n\n<!-- memo -->\n\n二行目")).toContain(
      '<p data-source-line="5">二行目</p>'
    );
    expect(preview("一行目\n\n<!-- pagebreak -->\n\n二行目")).toContain(
      '<p data-source-line="5">二行目</p>'
    );
    expect(exported("一行目\n\n<!-- pagebreak -->\n\n二行目")).toContain(
      '<p data-source-line="5">二行目</p>'
    );
  });
});

describe("HTML / PDF export documents (#733)", () => {
  const assembly = (rawText: string): ExportAssembly => ({
    format: "htmlCombined",
    bodyNotation: "markdown",
    headingRemovalLevel: 0,
    documents: [
      {
        filePath: "chapter1.md",
        parentPath: "",
        fileName: "chapter1.md",
        kind: "markdown",
        text: rawText,
        rawText
      }
    ],
    appendFileStructureToc: false,
    imageAssetFolderName: "exports.assets",
    projectName: "Pagebreak"
  });
  const source = "A\n\n<!-- pagebreak -->\n\n<!-- 作者メモ -->\n\nB";

  it("HTML export keeps the page-break element + CSS and drops normal comments", async () => {
    const { htmlContent } = await generateCombinedHtml(assembly(source));

    expect(htmlContent).toContain(PAGEBREAK_ELEMENT);
    expect(htmlContent).toContain(".pergamum-pagebreak {");
    expect(htmlContent).not.toContain("作者メモ");
    expect(htmlContent).not.toContain("<!-- pagebreak -->");
  });

  it.each([
    ["horizontal", "horizontal" as const],
    ["vertical", "vertical-rl" as const]
  ])("PDF export HTML (%s) forces a page break at the directive", async (_label, mode) => {
    const { htmlContent } = await generateCombinedHtml(assembly(source), {
      isPdf: true,
      pdfWritingMode: mode
    });

    expect(htmlContent).toContain(PAGEBREAK_ELEMENT);
    expect(htmlContent).toMatch(
      /\.pergamum-pagebreak \{\s+break-before: page;\s+page-break-before: always;\s+\}/
    );
    expect(htmlContent.indexOf(">A<")).toBeLessThan(htmlContent.indexOf(PAGEBREAK_ELEMENT));
    expect(htmlContent.indexOf(PAGEBREAK_ELEMENT)).toBeLessThan(htmlContent.indexOf(">B<"));
    expect(htmlContent).not.toContain("作者メモ");
    expect(htmlContent).toContain(
      mode === "vertical-rl" ? "pergamum-export-pdf-vertical" : "<body>"
    );
  });

  // Regression (#733 dogfood): the directive was escaped to visible text — no
  // element at all — for the prose body notations (Narou / Kakuyomu / Aozora).
  it.each(["markdown", "narou", "kakuyomu", "aozora"] as const)(
    "%s notation: HTML export has the page-break element AND its CSS, no comment text",
    async (bodyNotation) => {
      const { htmlContent } = await generateCombinedHtml({
        ...assembly(source),
        bodyNotation
      });

      expect(htmlContent).toContain(PAGEBREAK_ELEMENT);
      expect(htmlContent).toContain(".pergamum-pagebreak {");
      expect(htmlContent).not.toContain("pagebreak --&gt;");
      expect(htmlContent).not.toContain("<!-- pagebreak -->");
      expect(htmlContent).not.toContain("作者メモ");
      expect(htmlContent.indexOf(">A<")).toBeLessThan(htmlContent.indexOf(PAGEBREAK_ELEMENT));
      expect(htmlContent.indexOf(PAGEBREAK_ELEMENT)).toBeLessThan(htmlContent.indexOf(">B<"));
    }
  );

  it.each(["narou", "kakuyomu", "aozora"] as const)(
    "%s notation: PDF HTML (horizontal and vertical) breaks the page at the directive",
    async (bodyNotation) => {
      for (const pdfWritingMode of ["horizontal", "vertical-rl"] as const) {
        const { htmlContent } = await generateCombinedHtml(
          { ...assembly(source), bodyNotation },
          { isPdf: true, pdfWritingMode }
        );

        expect(htmlContent).toContain(PAGEBREAK_ELEMENT);
        expect(htmlContent).toMatch(
          /\.pergamum-pagebreak \{\s+break-before: page;\s+page-break-before: always;\s+\}/
        );
      }
    }
  );

  it("prose notations keep inline `<!-- -->` text and handle start / end / consecutive directives", async () => {
    const render = async (text: string) =>
      (
        await generateCombinedHtml({
          ...assembly(text),
          bodyNotation: "narou"
        })
      ).htmlContent;

    expect(await render("本文 <!-- memo --> 続き")).toContain("&lt;!-- memo --&gt;");
    const edges = await render("<!-- pagebreak -->\n\nA\n\n<!-- pagebreak -->");
    expect(edges.match(/pergamum-pagebreak" aria-hidden/g)).toHaveLength(2);
    const tight = await render("A\n<!-- pagebreak -->\nB\n<!-- pagebreak -->\n<!-- pagebreak -->");
    expect(tight.match(/pergamum-pagebreak" aria-hidden/g)).toHaveLength(3);
    expect(tight).toContain("<p>A</p>");
    expect(tight).toContain("<p>B</p>");
  });
});

describe("option forwarding: pageBreakOutput reaches the markdown-it rule (#733 regression)", () => {
  const md = "A\n\n<!-- pagebreak -->\n\nB";

  it("1. normal Preview render emits nothing for the directive", () => {
    const html = markdownPreviewRenderer.render(md, { previewRenderer: "markdown" });

    expect(html).not.toContain("pagebreak");
    expect(html).not.toContain("<!--");
  });

  it('2. markdownPreviewRenderer.render with pageBreakOutput: "element" emits the element', () => {
    const html = markdownPreviewRenderer.render(md, {
      previewRenderer: "markdown",
      pageBreakOutput: "element"
    });

    expect(html).toContain(PAGEBREAK_ELEMENT);
    // The default ("none", or omitted) never does, even for the same input.
    expect(
      markdownPreviewRenderer.render(md, { pageBreakOutput: "none" })
    ).not.toContain("pergamum-pagebreak");
  });

  it("3. renderMarkdownStaticExport (public entry point) emits the element", async () => {
    const result = await renderMarkdownStaticExport({
      markdown: md,
      imageResolutionContext: { kind: "projectRoot" },
      imageAssetFolderName: "assets",
      mermaidMessages: {
        emptyMessage: "",
        errorMessage: "",
        errorHint: "",
        showDetailsLabel: ""
      }
    });

    expect(result.html).toContain(PAGEBREAK_ELEMENT);
  });

  it("4. generateCombinedHtml's final HTML has the element and the CSS (HTML and PDF)", async () => {
    const assemblyFor = (rawText: string): ExportAssembly => ({
      format: "htmlCombined",
      bodyNotation: "markdown",
      headingRemovalLevel: 0,
      documents: [
        {
          filePath: "chapter1.md",
          parentPath: "",
          fileName: "chapter1.md",
          kind: "markdown",
          text: rawText,
          rawText
        }
      ],
      appendFileStructureToc: false,
      imageAssetFolderName: "exports.assets",
      projectName: "Pagebreak"
    });

    for (const options of [undefined, { isPdf: true }]) {
      const { htmlContent } = await generateCombinedHtml(assemblyFor(md), options);

      expect(htmlContent).toContain(PAGEBREAK_ELEMENT);
      expect(htmlContent).toContain("break-before: page;");
      expect(htmlContent).toContain(".pergamum-pagebreak {");
    }
  });

  it("the render() env is rebuilt explicitly, so the option must be forwarded there", () => {
    const source = readFileSync(
      "src/renderer/preview/markdownPreviewRenderer.ts",
      "utf8"
    );

    expect(source).toContain("pageBreakOutput: options?.pageBreakOutput");
    expect(
      readFileSync("src/renderer/export/markdownStaticExportRenderer.ts", "utf8")
    ).toContain('pageBreakOutput: "element"');
  });
});
