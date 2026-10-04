import { describe, expect, it } from "vitest";
import { aozoraPreviewRenderer } from "../../src/renderer/preview/aozoraPreviewRenderer";

const render = (content: string) =>
  aozoraPreviewRenderer.render(content, { previewRenderer: "aozoraHorizontal" });

describe("Aozora Preview hides standalone comments and pagebreak (#733)", () => {
  it("does not render a standalone comment", () => {
    const html = render("一行目\n<!-- memo -->\n三行目");

    expect(html).not.toContain("memo");
    expect(html).not.toContain("&lt;!--");
    expect(html).not.toContain("<!--");
  });

  it("does not render <!-- pagebreak -->", () => {
    const html = render("一行目\n<!-- pagebreak -->\n三行目");

    expect(html).not.toContain("pagebreak");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("&lt;");
  });

  it("keeps the surrounding text and emits no empty paragraph or placeholder", () => {
    const html = render("一行目\n<!-- memo -->\n<!-- pagebreak -->\n三行目");

    expect(html).toBe(
      '<p data-source-line="1">一行目</p>\n<p data-source-line="4">三行目</p>'
    );
  });

  it("keeps the original source line numbers of the following lines", () => {
    const html = render(
      "<!-- pagebreak -->\nA\n\n<!-- memo -->\n<!-- memo -->\nB\n  <!-- x -->   \nC"
    );

    expect(html).toContain('<p data-source-line="2">A</p>');
    expect(html).toContain('<p data-source-line="3"><br></p>');
    expect(html).toContain('<p data-source-line="6">B</p>');
    expect(html).toContain('<p data-source-line="8">C</p>');
  });

  it("works with CRLF line endings", () => {
    expect(render("A\r\n<!-- pagebreak -->\r\nB")).toBe(
      '<p data-source-line="1">A</p>\n<p data-source-line="3">B</p>'
    );
  });

  it("leaves inline comment-like text visible (no inline support)", () => {
    const html = render("本文 <!-- memo --> 続き");

    expect(html).toContain("本文");
    expect(html).toContain("続き");
    expect(html).toContain("&lt;!-- memo --&gt;");
  });

  it("does not widen to raw HTML or multi-line comments", () => {
    expect(render("<div>x</div>")).toContain("&lt;div&gt;");
    const multi = render("<!--\nmemo\n-->");
    expect(multi).toContain("&lt;!--");
    expect(multi).toContain("memo");
  });
});
