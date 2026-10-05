import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markdownPreviewRenderer } from "../../src/renderer/preview/markdownPreviewRenderer";
import { aozoraPreviewRenderer } from "../../src/renderer/preview/aozoraPreviewRenderer";
import { inlineKatexWoff2Fonts } from "../../src/renderer/glossaryExport/katexExportCss";

function renderMarkdownPreview(content: string): string {
  return markdownPreviewRenderer.render(content, { previewRenderer: "markdown" });
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/** The KaTeX stylesheet Preview and export load (same `katex` dependency). */
const katexCss = readFileSync("node_modules/katex/dist/katex.min.css", "utf8");

describe("markdownPreviewRenderer KaTeX math rendering (#566)", () => {
  describe("Markdown horizontal preview (previewRenderer: 'markdown')", () => {
    it("renders inline math ($...$) as KaTeX", () => {
      const html = markdownPreviewRenderer.render(
        "これは $E = mc^2$ の例です。",
        { previewRenderer: "markdown" }
      );

      expect(html).toContain('class="katex"');
      expect(html).toContain("katex-mathml");
      expect(html).toContain("katex-html");
      // The literal "$" delimiters must not survive into the output.
      expect(html).not.toContain("$E = mc^2$");
    });

    it("renders single-line display math ($$...$$) as KaTeX display math", () => {
      const html = markdownPreviewRenderer.render("$$ E = mc^2 $$", {
        previewRenderer: "markdown"
      });

      expect(html).toContain("katex-block");
      expect(html).toContain("katex-display");
    });

    it("renders multiline display math as KaTeX display math", () => {
      const md = "$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$";
      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      expect(html).toContain("katex-block");
      expect(html).toContain("katex-display");
      expect(html).toContain("int_0^1"); // present in the MathML annotation
    });

    it("renders multiple math expressions in one document", () => {
      const md =
        "$a = 1$ and $b = 2$\n\n$$\nc = 3\n$$\n\n$$\nd = 4\n$$";
      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      // Every inline/display expression contains its own `class="katex"`
      // span (display math nests one inside `katex-display`), so this is
      // 2 inline + 2 display = 4.
      const katexSpanCount = (html.match(/class="katex"/g) ?? []).length;
      const displayBlockCount = (html.match(/katex-block/g) ?? []).length;
      expect(katexSpanCount).toBe(4);
      expect(displayBlockCount).toBe(2);
    });

    it("carries data-source-line on a display math block for scroll-sync", () => {
      const md = "# Title\n\n$$\nE = mc^2\n$$";
      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      expect(html).toMatch(/<div class="katex-block" data-source-line="3">/);
    });

    it("does not throw and keeps the rest of the preview intact when math is invalid", () => {
      const md = "前置き\n\n$\\invalidcmd{$\n\n後書き";

      expect(() =>
        markdownPreviewRenderer.render(md, { previewRenderer: "markdown" })
      ).not.toThrow();

      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });
      expect(html).toContain("前置き");
      expect(html).toContain("後書き");
      expect(html).toContain("katex-error");
    });

    it("does not inject raw math source or error text as unescaped HTML", () => {
      const md = "$\\text{<img src=x onerror=alert(1)>}$";

      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).not.toContain("onerror=alert(1)>");
    });

    it("keeps ordinary dollar-sign prose as plain text (matches the plugin's own delimiter behavior)", () => {
      const html = markdownPreviewRenderer.render(
        "これは通常のドル表記です: $100 and $200",
        { previewRenderer: "markdown" }
      );

      expect(html).toContain("$100 and $200");
      expect(html).not.toContain('class="katex"');
    });
  });

  // ---------------------------------------------------------------------
  // Scope guard: KaTeX must never activate outside Markdown horizontal
  // preview, even though narouHorizontal / kakuyomuHorizontal /
  // narouVertical / kakuyomuVertical share this SAME markdown-it instance.
  // ---------------------------------------------------------------------
  describe("scope guard — math stays literal text outside Markdown horizontal preview", () => {
    const mathMd = "これは $E = mc^2$ の例です。";

    it.each([
      "narouHorizontal",
      "kakuyomuHorizontal",
      "narouVertical",
      "kakuyomuVertical"
    ] as const)("does not render math for previewRenderer=%s", (previewRenderer) => {
      const html = markdownPreviewRenderer.render(mathMd, { previewRenderer });

      expect(html).not.toContain('class="katex"');
      expect(html).toContain("$E = mc^2$");
    });

    it("does not render math when previewRenderer is omitted (e.g. Glossary preview)", () => {
      const html = markdownPreviewRenderer.render(mathMd);

      expect(html).not.toContain('class="katex"');
      expect(html).toContain("$E = mc^2$");
    });

    it("does not affect Aozora preview (separate rendering pipeline)", () => {
      const html = aozoraPreviewRenderer.render(mathMd, {
        previewRenderer: "aozoraHorizontal"
      });

      expect(html).not.toContain('class="katex"');
    });

    it("re-enables math on a subsequent Markdown horizontal render after a non-math render", () => {
      // Guards against the enable/disable toggle leaking stale state between
      // calls — Narou first, then Markdown, on the SAME shared instance.
      markdownPreviewRenderer.render(mathMd, {
        previewRenderer: "narouHorizontal"
      });
      const html = markdownPreviewRenderer.render(mathMd, {
        previewRenderer: "markdown"
      });

      expect(html).toContain('class="katex"');
    });
  });

  // ---------------------------------------------------------------------
  // Regression: existing fence handling (#536 highlight.js, #564 Mermaid)
  // and ordinary Markdown must be unaffected by KaTeX.
  // ---------------------------------------------------------------------
  describe("regression — existing fence / rendering behavior unchanged", () => {
    it("still highlights a ts fenced code block via highlight.js", () => {
      const md = "```ts\nconst x: number = 1;\n```";
      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      expect(html).toContain("hljs language-ts");
    });

    it("still renders a mermaid fenced code block as a Mermaid placeholder", () => {
      const md = "```mermaid\ngraph TD\n  A --> B\n```";
      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      expect(html).toContain("markdownMermaidBlock");
      expect(html).not.toContain('class="katex"');
    });

    it("does not affect ordinary Markdown rendering", () => {
      const md = "# Title\n\nSome paragraph text.";
      const html = markdownPreviewRenderer.render(md, {
        previewRenderer: "markdown"
      });

      expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
      expect(html).toContain("Some paragraph text.");
      expect(html).not.toContain('class="katex"');
    });

    it("keeps headings, lists, links, images, code, callouts and Mermaid working next to math", () => {
      const md = [
        "# 見出し",
        "",
        "- 項目 $x^2$",
        "- [リンク](https://example.com)",
        "",
        "![図](https://example.com/a.png)",
        "",
        "```ts",
        "const price = \"$5\";",
        "```",
        "",
        "> [!NOTE]",
        "> 注記 $\\alpha$",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "",
        "$$",
        "\\frac{a}{b}",
        "$$"
      ].join("\n");
      const html = renderMarkdownPreview(md);

      expect(html).toMatch(/<h1[^>]*>見出し<\/h1>/);
      expect(html).toMatch(/<li[^>]*>項目 <span class="katex">/);
      expect(html).toContain('<a href="https://example.com">リンク</a>');
      expect(html).toContain('src="https://example.com/a.png"');
      expect(html).toContain("hljs language-ts");
      // `$` inside a code fence is code, never math.
      expect(html).toContain("$5");
      expect(html).toContain("markdown-callout-note");
      expect(html).toContain("markdownMermaidBlock");
      expect(countMatches(html, /class="katex-block"/g)).toBe(1);
      expect(countMatches(html, /class="katex"/g)).toBe(3);
    });
  });
});

describe("markdownMath syntax and KaTeX rendering (#743)", () => {
  it.each([
    ["fraction", "\\frac{a}{b}", "mfrac"],
    ["square root", "\\sqrt{x}", "sqrt"],
    ["subscript", "x_i", "msupsub"],
    ["superscript", "x^2", "msupsub"],
    ["summation", "\\sum_{i=1}^{n} i", "op-symbol"],
    ["Greek letter", "\\alpha", "mord"]
  ])("renders %s as inline math", (_label, latex, expectedClass) => {
    const html = renderMarkdownPreview(`本文 $${latex}$ 本文`);

    expect(html).toContain('class="katex"');
    expect(html).toContain(expectedClass);
    expect(html).toContain(
      `<annotation encoding="application/x-tex">${latex}</annotation>`
    );
    expect(html).not.toContain("katex-error");
    expect(html).toMatch(/^<p[^>]*>本文 <span class="katex">/);
    expect(html).toContain("</span> 本文</p>");
  });

  it("renders the inline Pythagorean example without leaking delimiters", () => {
    const html = renderMarkdownPreview("本文 $x^2 + y^2 = z^2$ 本文");

    expect(countMatches(html, /class="katex"/g)).toBe(1);
    expect(html).not.toContain("$");
  });

  it("renders $$...$$ inside a paragraph as display math", () => {
    const html = renderMarkdownPreview("前 $$\\sum_{i=1}^{n} i$$ 後");

    expect(html).toContain('class="katex-display"');
    expect(html).toContain("前 ");
    expect(html).toContain(" 後");
  });

  it("renders a display block whose closing $$ ends the last content line", () => {
    const html = renderMarkdownPreview("$$\n\\sqrt{x}\n+ 1 $$\n\n後書き");

    expect(countMatches(html, /class="katex-block"/g)).toBe(1);
    expect(html).toContain("後書き");
  });

  it("renders a display block inside a list item", () => {
    const html = renderMarkdownPreview("- 式:\n\n  $$\n  x^2\n  $$\n");

    expect(html).toMatch(/<li[^>]*>[\s\S]*class="katex-block"[\s\S]*<\/li>/);
  });

  it.each([
    ["a space after the opening $", "これは $ x$ です"],
    ["a space before the closing $", "これは $x $ です"],
    ["a digit after the closing $", "価格は $5 から $10 です"],
    ["escaped dollars", "これは \\$x\\$ です"],
    ["an empty pair", "これは $$ です"]
  ])("keeps prose literal with %s", (_label, md) => {
    const html = renderMarkdownPreview(md);

    expect(html).not.toContain('class="katex');
    expect(html).toContain("$");
  });

  it("keeps an unclosed $$ block as ordinary text", () => {
    const html = renderMarkdownPreview("$$\nx^2\n\n本文");

    expect(html).not.toContain("katex-block");
    expect(html).toContain("本文");
  });

  it("does not treat an indented $$ as math (indented code wins)", () => {
    const html = renderMarkdownPreview("    $$\n    x\n    $$");

    expect(html).toMatch(/<pre[^>]*><code>\$\$/);
    expect(html).not.toContain('class="katex');
  });

  it.each([
    ["unknown command", "$\\notacommand{x}$"],
    ["incomplete expression", "$x^{$"],
    ["unbalanced braces in a block", "$$\n\\frac{a}{b\n$$"],
    ["environment KaTeX rejects inline", "$\\begin{align}a&=b\\end{align}$"]
  ])("renders %s without throwing and keeps the document", (_label, math) => {
    const md = `前置き\n\n${math}\n\n後書き`;

    expect(() => renderMarkdownPreview(md)).not.toThrow();

    const html = renderMarkdownPreview(md);
    expect(html).toContain("前置き");
    expect(html).toContain("後書き");
    expect(html).toContain('class="katex');
  });

  it("does not honour URL / HTML commands (trust stays off)", () => {
    const html = renderMarkdownPreview(
      "$\\href{javascript:alert(1)}{x}$ $\\htmlClass{evil}{y}$"
    );

    expect(html).not.toContain("javascript:alert(1)\"");
    expect(html).not.toMatch(/<a [^>]*href=/);
    expect(html).not.toContain('class="evil"');
  });

  it("uses only KaTeX classes the bundled KaTeX stylesheet defines (one KaTeX generation)", () => {
    const html = renderMarkdownPreview(
      "$\\frac{a}{b} \\sqrt{x} x_i x^2 \\alpha$\n\n$$\n\\sum_{i=1}^{n} i\n$$"
    );
    const katexClasses = new Set<string>();
    for (const match of html.matchAll(/class="([^"]+)"/g)) {
      for (const name of match[1].split(/\s+/)) {
        // `katex-block` is Pergamum's own wrapper, not a KaTeX class.
        if (name.startsWith("katex") && name !== "katex-block") {
          katexClasses.add(name);
        }
      }
    }

    expect(katexClasses.size).toBeGreaterThan(0);
    for (const name of katexClasses) {
      expect(katexCss, `.${name} missing from katex.min.css`).toContain(`.${name}`);
    }
  });
});

describe("KaTeX export stylesheet from the installed katex package (#743)", () => {
  it("inlines every woff2 font and drops all woff / ttf fallbacks", async () => {
    const fontNames = [
      ...new Set(
        [...katexCss.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map(
          (match) => match[1]
        )
      )
    ];
    const loaders = Object.fromEntries(
      fontNames.map((name) => [
        `/node_modules/katex/dist/fonts/${name}`,
        async () => "data:font/woff2;base64,AAAA"
      ])
    );

    const inlined = await inlineKatexWoff2Fonts(katexCss, loaders);

    expect(fontNames.length).toBeGreaterThan(0);
    expect(inlined).not.toContain("url(fonts/");
    expect(inlined).not.toMatch(/format\("(?:woff|truetype)"\)/);
    expect(countMatches(inlined, /url\(data:font\/woff2;base64,AAAA\)/g)).toBe(
      countMatches(katexCss, /url\(fonts\/[^)]+\.woff2\)/g)
    );
  });
});

describe("Renderer CSP policy and KaTeX large delimiters (#749)", () => {
  it("includes font-src 'self' data: in renderer index.html CSP meta tag without relaxing security boundary", () => {
    const htmlContent = readFileSync("index.html", "utf8");
    const cspMatch = htmlContent.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
    );

    expect(cspMatch, "index.html must contain a CSP meta tag").not.toBeNull();
    const cspPolicy = cspMatch![1];

    // Verify font-src includes 'self' data: for bundled KaTeX fonts
    expect(cspPolicy).toContain("font-src 'self' data:");

    // Verify critical directives are strictly preserved
    expect(cspPolicy).toContain("default-src 'self'");
    expect(cspPolicy).toContain("script-src 'self' 'unsafe-inline'");
    expect(cspPolicy).toContain("style-src 'self' 'unsafe-inline'");
    expect(cspPolicy).toContain("img-src 'self' data: blob: pergamum-asset:");
    expect(cspPolicy).toContain(
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
    );

    // Verify forbidden wildcard or unsafe relaxations are NOT present
    expect(cspPolicy).not.toContain("default-src *");
    expect(cspPolicy).not.toContain("font-src *");
    expect(cspPolicy).not.toContain("script-src *");
    expect(cspPolicy).not.toContain("unsafe-eval");
  });

  it("renders large delimiters (\\Big, \\Bigg, \\Bigl, \\Biggl) without KaTeX errors", () => {
    const md = [
      "$$",
      "\\Bigl( x + y \\Bigr)",
      "$$",
      "",
      "$$",
      "\\Biggl[ \\frac{a}{b} \\Biggr]",
      "$$"
    ].join("\n");

    const html = renderMarkdownPreview(md);

    expect(html).toContain('class="katex-display"');
    expect(html).toContain("delimsizing");
    expect(html).not.toContain("katex-error");
    expect(countMatches(html, /class="katex-block"/g)).toBe(2);
  });
});
