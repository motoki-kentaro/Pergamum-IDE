import { Compartment, EditorSelection, Facet, Prec, findClusterBreak, type Extension } from "@codemirror/state";
import {
  Decoration, type DecorationSet, EditorView, getDrawSelectionConfig, layer, RectangleMarker, ViewPlugin,
  type LayerMarker, type ViewUpdate
} from "@codemirror/view";
import type { CaretStyle } from "../shared/caretSettings";

export const caretStyleCompartment = new Compartment();
const layerClass = "pergamum-blockCaretLayer";
const coveredAttribute = "data-pergamum-block-covered";

/** Find the complete display unit, including positions inside a cluster. */
export function caretCluster(text: string, pos: number): { from: number; to: number; text: string } | null {
  if (pos >= text.length) return null;
  let from = 0;
  while (from < text.length) {
    const to = findClusterBreak(text, from, true, true);
    if (to > pos) return { from, to, text: text.slice(from, to) };
    from = to;
  }
  return null;
}

export class BlockCaretMarker implements LayerMarker {
  constructor(
    readonly left: number, readonly top: number,
    readonly width: number, readonly height: number
  ) {}

  eq(other: LayerMarker): boolean {
    return other instanceof BlockCaretMarker &&
      this.left === other.left && this.top === other.top &&
      this.width === other.width && this.height === other.height;
  }

  draw(): HTMLElement {
    const dom = document.createElement("div");
    this.update(dom);
    return dom;
  }

  update(dom: HTMLElement): boolean {
    dom.className = "pergamum-blockCaret";
    dom.style.left = `${this.left}px`;
    dom.style.top = `${this.top}px`;
    dom.style.width = `${this.width}px`;
    dom.style.height = `${this.height}px`;
    return true;
  }
}

function canDraw(view: EditorView, preview: boolean): boolean {
  return !view.state.readOnly && view.state.facet(EditorView.editable) &&
    (preview || view.hasFocus) && !(view.plugin(blockCaretController)?.composing ?? view.compositionStarted);
}

/** RectangleMarker gives document-relative, bidi/wrap/scale-aware geometry. */
export function collectBlockCarets(view: EditorView, preview = false): BlockCaretMarker[] {
  if (!canDraw(view, preview)) return [];
  const markers: BlockCaretMarker[] = [];
  for (const range of view.state.selection.ranges) {
    if (!range.empty) continue;
    const line = view.state.doc.lineAt(range.head);
    const cluster = caretCluster(line.text, range.head - line.from);
    if (!cluster) {
      // Empty line / EOL: no copied character. Use the cursor rectangle's
      // origin and resolve the local writing direction for the empty box.
      const cursor = RectangleMarker.forRange(view, "", range);
      const coords = view.coordsAtPos(range.head, range.assoc || 1);
      if (!coords) continue;
      const rtl = view.bidiSpans(line).some((span) =>
        span.from <= range.head - line.from && span.to >= range.head - line.from && (span.level & 1) !== 0
      );
      const width = view.defaultCharacterWidth * view.scaleX;
      for (const rect of cursor) {
        markers.push(new BlockCaretMarker(rect.left - (rtl ? width : 0), rect.top, width, rect.height));
      }
    }
  }
  return markers;
}

/** Match only the existing cursors for empty ranges. Non-empty selection
 * cursors remain entirely under drawSelection's control, including mixed ranges.
 */
class BlockCaretController {
  composing: boolean;
  decorations: DecorationSet = Decoration.none;
  private phase = false;
  private measure = {
    read: (view: EditorView) => canDraw(view, this.preview)
      ? view.state.selection.ranges.filter((range) => range.empty).flatMap((range) =>
        RectangleMarker.forRange(view, "", range).map((rect) => ({
          left: rect.left, top: rect.top, primary: range === view.state.selection.main
        })))
      : [],
    write: (positions: { left: number; top: number; primary: boolean }[], view: EditorView) => {
      for (const cursor of view.scrollDOM.querySelectorAll<HTMLElement>(".cm-cursorLayer .cm-cursor")) {
        const covered = positions.some((pos) =>
          pos.primary === cursor.classList.contains("cm-cursor-primary") &&
          Math.abs(parseFloat(cursor.style.left) - pos.left) < 0.01 &&
          Math.abs(parseFloat(cursor.style.top) - pos.top) < 0.01
        );
        cursor.toggleAttribute(coveredAttribute, covered);
      }
    }
  };

  constructor(private view: EditorView, private preview: boolean) {
    this.composing = view.compositionStarted;
    this.rebuildMarks();
    view.requestMeasure(this.measure);
  }

  private rebuildMarks(): void {
    if (this.view.state.readOnly || !this.view.state.facet(EditorView.editable) || !(this.preview || this.view.hasFocus) || this.composing) {
      this.decorations = Decoration.none;
      return;
    }
    const blink = getDrawSelectionConfig(this.view.state).cursorBlinkRate;
    const animation = blink === 0 ? "none" : this.phase ? "pergamum-blockTextBlink" : "pergamum-blockTextBlink2";
    const ranges = this.view.state.selection.ranges.filter(range => range.empty).flatMap(range => {
      const line = this.view.state.doc.lineAt(range.head);
      const cluster = caretCluster(line.text, range.head - line.from);
      return cluster ? [Decoration.mark({class: "pg-block-caret-text", attributes: {
        style: `animation-name:${animation};animation-duration:${blink}ms`
      }}).range(line.from + cluster.from, line.from + cluster.to)] : [];
    });
    const unique = ranges.filter((range, i) => ranges.findIndex(other => other.from === range.from && other.to === range.to) === i);
    this.decorations = Decoration.set(unique, true);
  }

  update(update: ViewUpdate): void {
    if (update.selectionSet || update.docChanged ||
        getDrawSelectionConfig(update.startState).cursorBlinkRate !== getDrawSelectionConfig(update.state).cursorBlinkRate) {
      this.phase = !this.phase;
    }
    this.rebuildMarks();
    // Requested after the cursor and Block layer updates, so their DOM is
    // current when the write phase tags the native empty-range cursors.
    update.view.requestMeasure(this.measure);
  }

  composition(active: boolean): void {
    this.composing = active;
    this.view.dom.toggleAttribute("data-pergamum-caret-composing", active);
    if (active) this.restoreCursors();
    // A display-only transaction asks layer() to re-measure. No document,
    // selection, scrolling or history operation is attached to it.
    this.view.dispatch({});
  }

  private restoreCursors(): void {
    for (const cursor of this.view.scrollDOM.querySelectorAll(`[${coveredAttribute}]`)) {
      cursor.removeAttribute(coveredAttribute);
    }
  }

  destroy(): void {
    this.restoreCursors();
    this.view.dom.removeAttribute("data-pergamum-caret-composing");
  }
}

// Per-state preview flag, rather than shared mutable state across editor views.
const previewFacet = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });
const blockCaretController = ViewPlugin.define(
  (view) => new BlockCaretController(view, view.state.facet(previewFacet)),
  { // Higher-precedence marks nest inside syntax/Markdown marks. This lets
    // the hidden phase inherit their original color and all font properties.
    provide: plugin => Prec.highest(EditorView.decorations.of(view => view.plugin(plugin)?.decorations ?? Decoration.none)),
    eventObservers: {
    compositionstart() { this.composition(true); },
    compositionend() { this.composition(false); }
  } }
);

export function createCaretStyleExtension(style: CaretStyle, preview = false): Extension {
  if (style === "line") return [];
  return [
    previewFacet.of(preview),
    ...(preview ? [EditorView.editorAttributes.of({ "data-pergamum-caret-preview": "" })] : []),
    layer({
      above: true,
      class: layerClass,
      markers: (view) => collectBlockCarets(view, preview),
      update(update, dom) {
        const blink = getDrawSelectionConfig(update.state).cursorBlinkRate;
        dom.style.animationDuration = `${blink}ms`;
        if (update.selectionSet || update.docChanged || update.startState !== update.state &&
            getDrawSelectionConfig(update.startState).cursorBlinkRate !== blink) {
          dom.style.animationName = blink === 0 ? "none" :
            dom.style.animationName === "pergamum-blockCaretBlink" ? "pergamum-blockCaretBlink2" : "pergamum-blockCaretBlink";
        }
        return true;
      },
      mount(dom, view) {
        const blink = getDrawSelectionConfig(view.state).cursorBlinkRate;
        dom.style.animationDuration = `${blink}ms`;
        dom.style.animationName = blink === 0 ? "none" : "pergamum-blockCaretBlink";
      }
    }),
    blockCaretController,
    EditorView.theme({
      [`.${layerClass}`]: {
        display: "none", pointerEvents: "none", animationTimingFunction: "steps(1)",
        animationIterationCount: "infinite"
      },
      [`&.cm-focused .${layerClass}, &[data-pergamum-caret-preview] .${layerClass}`]: { display: "block" },
      ".pg-block-caret-text": {
        backgroundColor: "var(--pg-color-editor-caret)", color: "var(--pg-color-editor-background)",
        animationTimingFunction: "steps(1)", animationIterationCount: "infinite"
      },
      "@keyframes pergamum-blockTextBlink": {
        "0%, 100%": { backgroundColor: "var(--pg-color-editor-caret)", color: "var(--pg-color-editor-background)" },
        "50%": { backgroundColor: "transparent", color: "inherit" }
      },
      "@keyframes pergamum-blockTextBlink2": {
        "0%, 100%": { backgroundColor: "var(--pg-color-editor-caret)", color: "var(--pg-color-editor-background)" },
        "50%": { backgroundColor: "transparent", color: "inherit" }
      },
      ".pergamum-blockCaret": {
        backgroundColor: "var(--pg-color-editor-caret)"
      },
      [`&[data-pergamum-caret-composing] .${layerClass}`]: { display: "none" },
      [`.cm-cursor[${coveredAttribute}]`]: { visibility: "hidden" },
      "@keyframes pergamum-blockCaretBlink": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0 } },
      "@keyframes pergamum-blockCaretBlink2": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0 } }
    })
  ];
}
