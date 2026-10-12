/**
 * State and target detection for the Markdown Preview context menu (#799).
 */

export type PreviewContextMenuCommandId =
  | "copyRichText"
  | "copyPlainText"
  | "selectAll"
  | "copyLinkUrl"
  | "copySvgSource"
  | "copySvgPngImage"
  | "copyMathML";

export interface PreviewContextMenuTargetState {
  readonly x: number;
  readonly y: number;
  readonly hasSelection: boolean;
  readonly selectedRange: Range | null;
  readonly linkUrl: string | null;
  readonly svgElement: SVGSVGElement | null;
  readonly mathElement: Element | null;
  readonly previewElement: HTMLElement;
}

export interface DetectPreviewContextMenuOptions {
  readonly target: EventTarget | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly selection?: Selection | null;
}

/**
 * Detects whether a contextmenu event landed inside a Markdown preview surface,
 * and extracts relevant context data (selection range, link URL, SVG element).
 */
export function detectPreviewContextMenuTarget({
  target,
  clientX,
  clientY,
  selection = typeof window !== "undefined" ? window.getSelection() : null
}: DetectPreviewContextMenuOptions): PreviewContextMenuTargetState | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const previewElement = target.closest<HTMLElement>(".preview");
  if (!previewElement) {
    return null;
  }

  // 1. Text selection detection
  let hasSelection = false;
  let selectedRange: Range | null = null;

  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    // Ensure the selection is within or intersects the preview element
    const commonAncestor = range.commonAncestorContainer;
    const isInsidePreview =
      previewElement.contains(commonAncestor) ||
      (previewElement.contains(range.startContainer) &&
        previewElement.contains(range.endContainer));

    if (isInsidePreview && range.toString().length > 0) {
      hasSelection = true;
      selectedRange = range.cloneRange();
    }
  }

  // 2. Link detection
  const anchor = target.closest<HTMLAnchorElement>("a");
  const linkUrl = anchor ? anchor.getAttribute("href") : null;

  // 3. SVG detection (inline SVG or Mermaid diagram SVG)
  let svgElement: SVGSVGElement | null = target.closest<SVGSVGElement>("svg");
  if (!svgElement) {
    const mermaidContainer = target.closest(".markdownMermaidDiagram");
    if (mermaidContainer) {
      svgElement = mermaidContainer.querySelector<SVGSVGElement>("svg");
    }
  }

  // 4. KaTeX MathML detection (#799)
  let mathElement: Element | null = null;
  const katexContainer = target.closest(".katex, .katex-block");
  if (katexContainer) {
    mathElement = katexContainer.querySelector("math");
  } else {
    mathElement = target.closest("math");
  }

  return {
    x: clientX,
    y: clientY,
    hasSelection,
    selectedRange,
    linkUrl,
    svgElement,
    mathElement,
    previewElement
  };
}
