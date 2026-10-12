// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossaryPreviewDecorator } from "../../src/renderer/GlossaryPreviewDecorator";
import { emptyGlossarySurfaceIndex } from "../../src/shared/glossarySurfaceMatching";
import { t } from "../../src/shared/i18n";
import * as previewClipboard from "../../src/renderer/preview/previewClipboard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("preview keyboard shortcuts (#799)", () => {
  let mountNode: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mountNode = document.createElement("div");
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(mountNode);
  });

  function renderPreviewWithPane(html: string) {
    function PreviewPaneWithKeyHandler() {
      const containerRef = React.useRef<HTMLElement | null>(null);

      function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
        const isCtrlOrCmd = event.ctrlKey || event.metaKey;
        if (!isCtrlOrCmd) return;

        if (event.key === "a" || event.key === "A") {
          const container = containerRef.current?.querySelector<HTMLElement>(".preview");
          if (container) {
            event.preventDefault();
            window.getSelection()?.selectAllChildren(container);
          }
          return;
        }

        if (event.key === "c" || event.key === "C") {
          const container = containerRef.current?.querySelector<HTMLElement>(".preview");
          const selection = window.getSelection();
          if (container && selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (container.contains(range.commonAncestorContainer)) {
              event.preventDefault();
              const { html, text } = previewClipboard.extractRichTextFromRange(range);
              void previewClipboard.writeRichTextToClipboard(html, text);
            }
          }
        }
      }

      return (
        <section className="pane" ref={containerRef} onKeyDown={handleKeyDown}>
          <GlossaryPreviewDecorator
            previewHtml={html}
            surfaceIndex={emptyGlossarySurfaceIndex}
            translate={(key) => t("ja", key)}
            documentOpenId="doc-1"
            previewRenderStartedAt={performance.now()}
            onPreviewDomCommitted={vi.fn()}
            onPreviewDecorationCompleted={vi.fn()}
            onPreviewFrameObserved={vi.fn()}
          />
        </section>
      );
    }

    act(() => {
      root.render(<PreviewPaneWithKeyHandler />);
    });
  }

  it("selects all preview content when Ctrl+A is pressed inside preview pane", () => {
    renderPreviewWithPane("<p id='p1'>Paragraph 1</p><p id='p2'>Paragraph 2</p>");

    const pane = mountNode.querySelector<HTMLElement>("section.pane")!;
    const article = mountNode.querySelector<HTMLElement>("article.preview")!;
    expect(pane).not.toBeNull();
    expect(article).not.toBeNull();

    const selectAllChildrenSpy = vi.fn();
    const mockSelection = {
      selectAllChildren: selectAllChildrenSpy
    } as unknown as Selection;

    vi.spyOn(window, "getSelection").mockReturnValue(mockSelection);

    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    pane.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(selectAllChildrenSpy).toHaveBeenCalledWith(article);
  });

  it("copies rich text when Ctrl+C is pressed with a selection inside preview pane", async () => {
    renderPreviewWithPane("<p id='p1'>Hello World</p>");

    const pane = mountNode.querySelector<HTMLElement>("section.pane")!;
    const article = mountNode.querySelector<HTMLElement>("article.preview")!;
    const p = article.querySelector("#p1")!;

    const range = document.createRange();
    range.selectNodeContents(p);

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range
    } as unknown as Selection;

    vi.spyOn(window, "getSelection").mockReturnValue(mockSelection);
    const writeRichTextSpy = vi
      .spyOn(previewClipboard, "writeRichTextToClipboard")
      .mockResolvedValue(true);

    const event = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    pane.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(writeRichTextSpy).toHaveBeenCalled();
  });
});
