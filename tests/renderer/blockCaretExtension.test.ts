// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { Decoration, EditorView, RectangleMarker } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import { caretStyleCompartment, caretCluster, collectBlockCarets, createCaretStyleExtension } from "../../src/renderer/blockCaretExtension";
import { caretBlinkCompartment, createCaretBlinkExtension } from "../../src/renderer/caretSettingsCodeMirror";

const views: EditorView[] = [];
function editor(doc = "abcdef", selection: EditorSelection | ReturnType<typeof EditorSelection.cursor> = EditorSelection.cursor(2), readonly = false): EditorView {
  const view = new EditorView({ parent: document.body, state: EditorState.create({
    doc, selection, extensions: [EditorState.allowMultipleSelections.of(true), history(),
      EditorState.readOnly.of(readonly), caretBlinkCompartment.of(createCaretBlinkExtension(1200)),
      caretStyleCompartment.of(createCaretStyleExtension("block", true))]
  }) });
  views.push(view);
  return view;
}
afterEach(() => { views.splice(0).forEach(view => view.destroy()); vi.restoreAllMocks(); });
const marks = (view: EditorView) => [...view.contentDOM.querySelectorAll<HTMLElement>(".pg-block-caret-text")];

describe("#722 hybrid Block caret", () => {
  it.each(["a", "あ", "😀", "e\u0301", "👩‍💻", "🇯🇵"])("keeps the complete cluster %s", text => {
    for (let pos = 0; pos < text.length; pos++) {
      expect(caretCluster(text, pos)).toEqual({ from: 0, to: text.length, text });
      const view = editor(text, EditorSelection.cursor(pos));
      expect(marks(view).map(mark => mark.textContent)).toEqual([text]);
      expect(view.state.doc.toString()).toBe(text);
    }
    expect(caretCluster(text, text.length)).toBeNull();
  });

  it("marks only empty ranges in mixed multi-selection", () => {
    const view = editor("abcdef", EditorSelection.create([
      EditorSelection.cursor(0), EditorSelection.range(2, 4), EditorSelection.cursor(5)
    ]));
    expect(marks(view).map(mark => mark.textContent)).toEqual(["a", "f"]);
    view.dispatch({ selection: EditorSelection.range(0, 4) });
    expect(marks(view)).toHaveLength(0);
  });

  it("nests inside syntax marks without overriding font properties", () => {
    const view = editor();
    view.dispatch({ effects: caretStyleCompartment.reconfigure([
      createCaretStyleExtension("block", true), EditorView.decorations.of(Decoration.set([
        Decoration.mark({ class: "syntax", attributes: { style: "font-weight:bold;font-style:italic;color:red" } }).range(0, 6)
      ]))
    ]) });
    const mark = marks(view)[0]!;
    expect(mark.parentElement?.className).toBe("syntax");
    for (const property of ["font-family", "font-size", "font-weight", "font-style", "font-variant", "letter-spacing", "text-decoration"]) {
      expect(mark.style.getPropertyValue(property)).toBe("");
    }
    view.dispatch({ selection: { anchor: 3 } });
    expect(marks(view).map(mark => mark.textContent)).toEqual(["d"]);
  });

  it("uses the shared blink contract, including steady 0ms, and restores Line", () => {
    const view = editor();
    for (const blink of [1200, 0, 400]) {
      view.dispatch({ effects: caretBlinkCompartment.reconfigure(createCaretBlinkExtension(blink)) });
      expect(marks(view)[0]!.style.animationDuration).toBe(`${blink}ms`);
      expect(marks(view)[0]!.style.animationName === "none").toBe(blink === 0);
    }
    view.dispatch({ effects: caretStyleCompartment.reconfigure(createCaretStyleExtension("line")) });
    expect(marks(view)).toHaveLength(0);
    view.dispatch({ effects: caretStyleCompartment.reconfigure(createCaretStyleExtension("block", true)) });
    expect(marks(view)[0]!.style.animationDuration).toBe("400ms");
  });

  it("live updates theme variables without changing editor state", () => {
    const view = editor();
    view.dispatch({ effects: caretBlinkCompartment.reconfigure(createCaretBlinkExtension(0)) });
    const state = view.state;
    const style = document.createElement("style");
    style.textContent = "html.caret-test-light { --pg-color-editor-caret: #2563a8; --pg-color-editor-background: #ffffff; } html.caret-test-dark { --pg-color-editor-caret: #5b9bd5; --pg-color-editor-background: #1a1e25; }";
    document.head.append(style);
    const original = document.documentElement.className;
    try {
      for (const [theme, background, foreground] of [
        ["light", "#2563a8", "#ffffff"], ["dark", "#5b9bd5", "#1a1e25"]
      ]) {
        document.documentElement.className = `caret-test-${theme}`;
        const computed = getComputedStyle(marks(view)[0]!);
        expect(computed.backgroundColor).toBe(background);
        expect(computed.color).toBe(foreground);
        expect(view.state).toBe(state);
      }
    } finally { style.remove(); document.documentElement.className = original; }
  });

  it("removes marks and restores regular cursors during composition, then restores Block", () => {
    const view = editor();
    const native = document.createElement("div");
    native.className = "cm-cursor"; native.setAttribute("data-pergamum-block-covered", "");
    view.scrollDOM.append(native);
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    expect(marks(view)).toHaveLength(0);
    expect(collectBlockCarets(view, true)).toEqual([]);
    expect(native.hasAttribute("data-pergamum-block-covered")).toBe(false);
    expect(view.dom.hasAttribute("data-pergamum-caret-composing")).toBe(true);
    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(marks(view).map(mark => mark.textContent)).toEqual(["c"]);
    expect(view.dom.hasAttribute("data-pergamum-caret-composing")).toBe(false);
  });

  it("does not force Block on readonly surfaces", () => {
    const view = editor("abc", EditorSelection.cursor(1), true);
    expect(marks(view)).toHaveLength(0);
    expect(collectBlockCarets(view, true)).toEqual([]);
    expect(view.state.readOnly).toBe(true);
  });

  it.each(["abc", "", "abc\n"])("uses a text-free geometry rectangle at EOL/empty: %s", doc => {
    const view = editor(doc, EditorSelection.cursor(doc.length));
    vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 12, right: 12, top: 20, bottom: 36 });
    vi.spyOn(view, "bidiSpans").mockReturnValue([]);
    vi.spyOn(view, "defaultCharacterWidth", "get").mockReturnValue(8);
    vi.spyOn(RectangleMarker, "forRange").mockReturnValue([new RectangleMarker("", 12, 20, null, 16)]);
    const boxes = collectBlockCarets(view, true);
    expect(marks(view)).toHaveLength(0);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.width).toBe(8);
    expect(boxes[0]!.draw().textContent).toBe("");
  });

  it("does not change document, selection, undo history, scroll or drop cursor", () => {
    const view = editor();
    view.dispatch({ changes: { from: 6, insert: "!" } });
    const doc = view.state.doc, selection = view.state.selection, depth = undoDepth(view.state);
    view.scrollDOM.scrollTop = 43; view.scrollDOM.scrollLeft = 7;
    const drop = document.createElement("div"); drop.className = "cm-dropCursor"; drop.style.width = "2px";
    view.scrollDOM.append(drop);
    for (const style of ["line", "block", "line", "block"] as const) {
      view.dispatch({ effects: caretStyleCompartment.reconfigure(createCaretStyleExtension(style, true)) });
      expect(view.state.doc).toBe(doc); expect(view.state.selection).toBe(selection);
      expect(undoDepth(view.state)).toBe(depth);
      expect(view.scrollDOM.scrollTop).toBe(43); expect(view.scrollDOM.scrollLeft).toBe(7);
      expect(drop.hasAttribute("data-pergamum-block-covered")).toBe(false);
      expect(drop.style.width).toBe("2px");
    }
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("abcdef");
  });
});
