// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectPreviewContextMenuTarget,
  type PreviewContextMenuCommandId,
  type PreviewContextMenuTargetState
} from "../../src/renderer/preview/previewContextMenuState";
import {
  PreviewContextMenu,
  buildPreviewContextMenuItems
} from "../../src/renderer/preview/PreviewContextMenu";
import { t } from "../../src/shared/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("previewContextMenu (#799)", () => {
  describe("detectPreviewContextMenuTarget", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it("returns null when target is outside preview", () => {
      container.innerHTML = `
        <div class="outside">
          <p>Not preview</p>
        </div>
      `;
      const p = container.querySelector("p")!;
      const result = detectPreviewContextMenuTarget({
        target: p,
        clientX: 10,
        clientY: 20
      });

      expect(result).toBeNull();
    });

    it("detects selection within preview", () => {
      container.innerHTML = `
        <article class="preview">
          <p id="target">Sample preview text</p>
        </article>
      `;
      const p = container.querySelector("#target")!;
      const range = document.createRange();
      range.selectNodeContents(p);

      const mockSelection = {
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range
      } as unknown as Selection;

      const result = detectPreviewContextMenuTarget({
        target: p,
        clientX: 50,
        clientY: 60,
        selection: mockSelection
      });

      expect(result).not.toBeNull();
      expect(result?.hasSelection).toBe(true);
      expect(result?.selectedRange?.toString()).toBe("Sample preview text");
      expect(result?.linkUrl).toBeNull();
      expect(result?.svgElement).toBeNull();
    });

    it("detects anchor link inside preview", () => {
      container.innerHTML = `
        <article class="preview">
          <p><a id="link" href="https://example.com/page">Link text</a></p>
        </article>
      `;
      const link = container.querySelector("#link")!;
      const result = detectPreviewContextMenuTarget({
        target: link,
        clientX: 30,
        clientY: 40,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.hasSelection).toBe(false);
      expect(result?.linkUrl).toBe("https://example.com/page");
    });

    it("detects inline SVG element inside preview", () => {
      container.innerHTML = `
        <article class="preview">
          <svg id="svgElem" viewBox="0 0 10 10"><rect id="rect" width="10" height="10"/></svg>
        </article>
      `;
      const rect = container.querySelector("#rect")!;
      const result = detectPreviewContextMenuTarget({
        target: rect,
        clientX: 15,
        clientY: 25,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.svgElement?.id).toBe("svgElem");
    });

    it("detects Mermaid diagram SVG container", () => {
      container.innerHTML = `
        <article class="preview">
          <div class="markdownMermaidDiagram" id="mermaid">
            <svg id="mermaidSvg"><text id="mermaidText">Flow</text></svg>
          </div>
        </article>
      `;
      const text = container.querySelector("#mermaidText")!;
      const result = detectPreviewContextMenuTarget({
        target: text,
        clientX: 100,
        clientY: 120,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.svgElement?.id).toBe("mermaidSvg");
    });

    it("detects KaTeX inline math element inside preview", () => {
      container.innerHTML = `
        <article class="preview">
          <p>Formula: <span class="katex"><span class="katex-mathml"><math id="m1"><mi>x</mi></math></span><span class="katex-html"><span class="mord" id="symbol">x</span></span></span></p>
        </article>
      `;
      const symbol = container.querySelector("#symbol")!;
      const result = detectPreviewContextMenuTarget({
        target: symbol,
        clientX: 50,
        clientY: 50,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.mathElement?.id).toBe("m1");
    });

    it("detects KaTeX display math block inside preview", () => {
      container.innerHTML = `
        <article class="preview">
          <div class="katex-block" id="block">
            <span class="katex-display">
              <span class="katex">
                <span class="katex-mathml"><math id="m2"><mi>y</mi></math></span>
                <span class="katex-html"><span class="mord" id="blockSymbol">y</span></span>
              </span>
            </span>
          </div>
        </article>
      `;
      const blockSymbol = container.querySelector("#blockSymbol")!;
      const result = detectPreviewContextMenuTarget({
        target: blockSymbol,
        clientX: 80,
        clientY: 90,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.mathElement?.id).toBe("m2");
    });

    it("returns null mathElement for plain text or elements outside KaTeX", () => {
      container.innerHTML = `
        <article class="preview">
          <p id="plain">Plain text without math</p>
        </article>
      `;
      const plain = container.querySelector("#plain")!;
      const result = detectPreviewContextMenuTarget({
        target: plain,
        clientX: 20,
        clientY: 30,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.mathElement).toBeNull();
    });

    it("returns null mathElement when KaTeX error span has no math element", () => {
      container.innerHTML = `
        <article class="preview">
          <p><span class="katex-error" id="err">\\invalidTeX</span></p>
        </article>
      `;
      const err = container.querySelector("#err")!;
      const result = detectPreviewContextMenuTarget({
        target: err,
        clientX: 20,
        clientY: 30,
        selection: null
      });

      expect(result).not.toBeNull();
      expect(result?.mathElement).toBeNull();
    });
  });

  describe("PreviewContextMenu component", () => {
    let mountNode: HTMLDivElement;
    let root: Root;
    let onSelect: ReturnType<typeof vi.fn<(commandId: PreviewContextMenuCommandId) => void>>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
      mountNode = document.createElement("div");
      document.body.appendChild(mountNode);
      root = createRoot(mountNode);
      onSelect = vi.fn();
      onClose = vi.fn();
    });

    afterEach(() => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(mountNode);
    });

    function renderMenu(state: PreviewContextMenuTargetState) {
      act(() => {
        root.render(
          <PreviewContextMenu
            state={state}
            translate={(key) => t("ja", key)}
            onSelect={onSelect}
            onClose={onClose}
          />
        );
      });
    }

    function getMenuItems(): HTMLButtonElement[] {
      return Array.from(
        mountNode.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      );
    }

    it("renders items with text-only presentation matching EditContextMenu", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: true,
        selectedRange: null,
        linkUrl: "https://example.com",
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      renderMenu(state);

      const items = getMenuItems();
      expect(items.length).toBe(6);

      // Verify commands
      const commands = items.map((el) => el.getAttribute("data-preview-context-command"));
      expect(commands).toEqual([
        "copyRichText",
        "copyPlainText",
        "selectAll",
        "copyLinkUrl",
        "copySvgSource",
        "copySvgPngImage"
      ]);

      // copyRichText and copyPlainText enabled because hasSelection = true
      expect(items[0].disabled).toBe(false);
      expect(items[1].disabled).toBe(false);

      // selectAll is always enabled
      expect(items[2].disabled).toBe(false);

      // copyLinkUrl enabled because linkUrl is present
      expect(items[3].disabled).toBe(false);

      // SVG items disabled because svgElement is null
      expect(items[4].disabled).toBe(true);
      expect(items[5].disabled).toBe(true);
    });

    it("triggers onSelect when an enabled item is clicked", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: true,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      renderMenu(state);

      const items = getMenuItems();
      act(() => {
        items[0].click();
      });

      expect(onSelect).toHaveBeenCalledWith("copyRichText");
    });

    it("triggers onSelect with selectAll when selectAll item is clicked", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: false,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      renderMenu(state);

      const items = getMenuItems();
      act(() => {
        items[2].click();
      });

      expect(onSelect).toHaveBeenCalledWith("selectAll");
    });

    it("closes menu when Escape key is pressed", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: false,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      renderMenu(state);

      const menu = mountNode.querySelector('.editContextMenu')!;
      act(() => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });

      expect(onClose).toHaveBeenCalled();
    });

    it("closes menu when backdrop is clicked", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: false,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      renderMenu(state);

      const backdrop = mountNode.querySelector<HTMLDivElement>('.editContextMenuBackdrop')!;
      act(() => {
        backdrop.click();
      });

      expect(onClose).toHaveBeenCalled();
    });

    it("navigates enabled items with ArrowDown and ArrowUp", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: true,
        selectedRange: null,
        linkUrl: "https://example.com",
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      renderMenu(state);

      const items = getMenuItems();
      // First enabled item should have focus
      expect(document.activeElement).toBe(items[0]);

      const menu = mountNode.querySelector('.editContextMenu')!;
      act(() => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
        );
      });
      expect(document.activeElement).toBe(items[1]);

      act(() => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
        );
      });
      // items[2] is selectAll (enabled)
      expect(document.activeElement).toBe(items[2]);

      act(() => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
        );
      });
      // items[3] is copyLinkUrl (enabled)
      expect(document.activeElement).toBe(items[3]);

      // Going up returns to items[2]
      act(() => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
        );
      });
      expect(document.activeElement).toBe(items[2]);
    });

    it("renders copyMathML item and triggers onSelect when mathElement is present", () => {
      const previewEl = document.createElement("article");
      const math = document.createElement("math");
      const state: PreviewContextMenuTargetState = {
        x: 100,
        y: 150,
        hasSelection: false,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: math,
        previewElement: previewEl
      };

      renderMenu(state);

      const items = getMenuItems();
      const commands = items.map((el) => el.getAttribute("data-preview-context-command"));
      expect(commands).toContain("copyMathML");

      const mathItem = items.find(
        (el) => el.getAttribute("data-preview-context-command") === "copyMathML"
      )!;
      expect(mathItem).toBeDefined();
      expect(mathItem.disabled).toBe(false);

      act(() => {
        mathItem.click();
      });

      expect(onSelect).toHaveBeenCalledWith("copyMathML");
    });
  });

  describe("buildPreviewContextMenuItems", () => {
    it("excludes copyMathML command when mathElement is null", () => {
      const previewEl = document.createElement("article");
      const state: PreviewContextMenuTargetState = {
        x: 0,
        y: 0,
        hasSelection: false,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: null,
        previewElement: previewEl
      };

      const items = buildPreviewContextMenuItems(state, (k) => t("ja", k));
      const commandIds = items.map((i) => i.commandId);

      expect(commandIds).not.toContain("copyMathML");
      expect(commandIds).toEqual([
        "copyRichText",
        "copyPlainText",
        "selectAll",
        "copyLinkUrl",
        "copySvgSource",
        "copySvgPngImage"
      ]);
    });

    it("includes copyMathML command when mathElement is present", () => {
      const previewEl = document.createElement("article");
      const math = document.createElement("math");
      const state: PreviewContextMenuTargetState = {
        x: 0,
        y: 0,
        hasSelection: false,
        selectedRange: null,
        linkUrl: null,
        svgElement: null,
        mathElement: math,
        previewElement: previewEl
      };

      const items = buildPreviewContextMenuItems(state, (k) => t("ja", k));
      const commandIds = items.map((i) => i.commandId);

      expect(commandIds).toContain("copyMathML");
      expect(commandIds).toEqual([
        "copyRichText",
        "copyPlainText",
        "selectAll",
        "copyLinkUrl",
        "copySvgSource",
        "copySvgPngImage",
        "copyMathML"
      ]);
      const mathItem = items.find((i) => i.commandId === "copyMathML")!;
      expect(mathItem.enabled).toBe(true);
      expect(mathItem.label).toBe("MathMLソースをコピー");
    });
  });
});
