// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { renderMarkdownStaticExport } from "../../src/renderer/export/markdownStaticExportRenderer";
import {
  markdownMermaidExportCss,
  renderMermaidDiagramsInContainer,
  renderMermaidDiagramsToStaticHtml,
  type MermaidPreviewMessages
} from "../../src/renderer/preview/markdownMermaidRendering";
import {
  buildGlossaryEntryExportHtml,
  type GlossaryExportDocumentLabels
} from "../../src/renderer/glossaryExport/glossaryExportHtml";
import type { GlossaryExportEntry } from "../../src/shared/glossaryExportEntry";

const stylesCssPath = resolve(__dirname, "../../src/renderer/styles.css");
const stylesCss = readFileSync(stylesCssPath, "utf-8");

const dummyMessages: MermaidPreviewMessages = {
  emptyMessage: "Empty diagram",
  errorMessage: "Mermaid error",
  errorHint: "Check syntax",
  showDetailsLabel: "Details"
};

describe("Mermaid diagram plate style (#813)", () => {
  it("defines figure plate styles for .preview .markdownMermaidBlock in styles.css", () => {
    const match = /\.preview\s+\.markdownMermaidBlock\s*\{([^}]*)\}/.exec(stylesCss);
    expect(match).not.toBeNull();
    const rules = match?.[1] ?? "";

    expect(rules).toMatch(/background(-color)?:\s*#ffffff/i);
    expect(rules).toMatch(/color:\s*#1f2328/i);
    expect(rules).toMatch(/border:\s*1px\s+solid\s+#d0d7de/i);
    expect(rules).toMatch(/border-radius:\s*6px/i);
    expect(rules).toMatch(/padding:\s*16px/i);
    expect(rules).toMatch(/margin:\s*16px\s+0/i);
    expect(rules).toMatch(/box-sizing:\s*border-box/i);
  });

  it("functions as a canvas plate with white background in both light and dark themes", () => {
    const window = new Window();
    const document = window.document;

    const styleEl = document.createElement("style");
    styleEl.textContent = stylesCss;
    document.head.appendChild(styleEl);

    // Test themes: default light and dark themes
    const themes = ["theme-light", "theme-night-dark", "theme-shine-moon", "theme-ginza-night"];

    for (const themeClass of themes) {
      const wrapper = document.createElement("div");
      wrapper.className = themeClass;
      wrapper.innerHTML = `
        <div class="preview">
          <div class="markdownMermaidBlock">
            <div class="markdownMermaidDiagram">
              <svg id="test-svg"></svg>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrapper);

      const blockEl = wrapper.querySelector(".markdownMermaidBlock");
      expect(blockEl).not.toBeNull();

      const computed = window.getComputedStyle(blockEl!);
      // Background must remain white plate regardless of theme wrapper
      expect(computed.backgroundColor).toMatch(/#ffffff|rgb\(255,\s*255,\s*255\)/i);
      expect(computed.color).toMatch(/#1f2328|rgb\(31,\s*35,\s*40\)/i);
      expect(computed.borderRadius).toBe("6px");
      expect(computed.padding).toBe("16px");

      document.body.removeChild(wrapper);
    }
  });

  it("exports markdownMermaidExportCss with plate rules for static exports", () => {
    expect(markdownMermaidExportCss).toContain(".markdownMermaidBlock");
    expect(markdownMermaidExportCss).toContain("background-color: #ffffff;");
    expect(markdownMermaidExportCss).toContain("border: 1px solid #d0d7de;");
    expect(markdownMermaidExportCss).toContain("border-radius: 6px;");
    expect(markdownMermaidExportCss).toContain("padding: 16px;");
    expect(markdownMermaidExportCss).toContain("break-inside: avoid;");
  });

  it("includes Mermaid plate CSS in renderMarkdownStaticExport exportCss", async () => {
    const result = await renderMarkdownStaticExport({
      markdown: "```mermaid\ngraph TD\nA-->B\n```",
      imageResolutionContext: { kind: "projectRoot" },
      imageAssetFolderName: "assets",
      mermaidMessages: dummyMessages,
      mermaidRender: vi.fn().mockResolvedValue({ svg: "<svg></svg>" })
    });

    expect(result.exportCss).toContain(".markdownMermaidBlock");
    expect(result.exportCss).toContain("background-color: #ffffff;");
    expect(result.exportCss).toContain("border: 1px solid #d0d7de;");
  });

  it("includes Mermaid plate CSS in glossary export HTML", () => {
    const dummyEntry: GlossaryExportEntry = {
      id: "entry-1",
      description: "```mermaid\ngraph TD\nA-->B\n```",
      atoms: [{ id: "atom-1", value: "テスト用語", matchFlags: 0, sortOrder: 0 }],
      tags: [],
      createdAt: null,
      updatedAt: null
    };

    const dummyLabels: GlossaryExportDocumentLabels = {
      infoHeading: "情報",
      representative: "代表表記",
      atoms: "表記揺れ",
      tags: "タグ",
      noTags: "タグなし",
      createdAt: "作成日",
      updatedAt: "更新日",
      occurrencesHeading: "出現数",
      atomColumn: "表記",
      countColumn: "件数",
      total: "合計",
      occurrenceScope: "全文書",
      occurrenceSkipped: null,
      descriptionHeading: "説明",
      emptyDescription: "説明なし"
    };

    const html = buildGlossaryEntryExportHtml({
      entry: dummyEntry,
      content: {
        includeGlossaryInfo: false,
        includeOccurrenceCounts: false,
        includeDescription: true
      },
      occurrences: null,
      description: {
        html: '<div class="markdownMermaidBlock"><div class="markdownMermaidDiagram"><svg></svg></div></div>',
        imageAssets: [],
        usesMath: false
      },
      labels: dummyLabels,
      lang: "ja",
      katexCss: null
    });

    expect(html).toContain(".markdownMermaidBlock");
    expect(html).toContain("background-color: #ffffff;");
    expect(html).toContain("border: 1px solid #d0d7de;");
    expect(html).toContain("border-radius: 6px;");
  });
});
