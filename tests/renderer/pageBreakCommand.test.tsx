// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec
} from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { markdownPageBreakInsertionTransactionSpec } from "../../src/renderer/MarkdownEditor";
import { canInsertPageBreakInEditor } from "../../src/renderer/pageBreakApplicability";
import {
  createGlossaryDescriptionCurrentEditor,
  createMarkdownCurrentEditor,
  createProjectImageCurrentEditor,
  type CurrentEditor
} from "../../src/renderer/currentEditor";
import {
  createProjectDocument,
  createUntitledDocument
} from "../../src/renderer/currentDocument";
import {
  createEditorCommands,
  createEditorCommandTitles
} from "../../src/renderer/editorCommands";
import { CommandRegistry } from "../../src/shared/commandRegistry";
import { editorCommandIds } from "../../src/shared/commandIds";
import {
  PAGE_BREAK_MARKUP,
  buildPageBreakInsertion
} from "../../src/shared/markdownPageBreakMarkup";
import { jaTranslations } from "../../src/shared/i18n/ja";
import { enTranslations } from "../../src/shared/i18n/en";
import type { ProjectDocument } from "../../src/shared/api";
import type { GlossaryEntry } from "../../src/shared/glossary";

/** `|` marks the cursor; `[` / `]` mark a selection's anchor / head. */
function stateFrom(marked: string): EditorState {
  const cursor = marked.indexOf("|");
  if (cursor >= 0) {
    return EditorState.create({
      doc: marked.replace("|", ""),
      selection: EditorSelection.cursor(cursor),
      extensions: [history()]
    });
  }
  const anchor = marked.indexOf("[");
  const head = marked.indexOf("]") - 1;
  return EditorState.create({
    doc: marked.replace("[", "").replace("]", ""),
    selection: EditorSelection.range(anchor, head),
    extensions: [history()]
  });
}

function insert(marked: string): { doc: string; cursor: number } {
  const state = stateFrom(marked);
  const next = state.update(markdownPageBreakInsertionTransactionSpec(state)).state;
  return { doc: next.doc.toString(), cursor: next.selection.main.head };
}

/** Every `<!-- pagebreak -->` sits alone on its line. */
function pageBreaksAreStandalone(doc: string): boolean {
  const lines = doc.split("\n");
  return (
    lines.includes(PAGE_BREAK_MARKUP) &&
    lines.every(
      (line) => !line.includes(PAGE_BREAK_MARKUP) || line === PAGE_BREAK_MARKUP
    )
  );
}

describe("page break insertion (#733)", () => {
  it("builds the directive with its own trailing blank line", () => {
    expect(buildPageBreakInsertion()).toEqual({
      text: "<!-- pagebreak -->\n\n",
      selectionOffsetFromInsertStart: "<!-- pagebreak -->\n\n".length
    });
  });

  it("empty document", () => {
    const result = insert("|");
    expect(result.doc).toBe("<!-- pagebreak -->\n\n");
    expect(result.cursor).toBe(result.doc.length);
  });

  it("document end: the directive never shares the text's line", () => {
    const result = insert("吾輩は猫である。|");
    expect(result.doc).toBe("吾輩は猫である。\n\n<!-- pagebreak -->\n\n");
    expect(result.cursor).toBe(result.doc.length);
    expect(pageBreaksAreStandalone(result.doc)).toBe(true);
  });

  it("line start of a paragraph", () => {
    const result = insert("|吾輩は猫である。");
    expect(result.doc).toBe("<!-- pagebreak -->\n\n吾輩は猫である。");
    expect(pageBreaksAreStandalone(result.doc)).toBe(true);
  });

  it("line middle splits the line around a standalone directive", () => {
    const result = insert("吾輩は|猫である。");
    expect(result.doc).toBe("吾輩は\n\n<!-- pagebreak -->\n\n猫である。");
    expect(pageBreaksAreStandalone(result.doc)).toBe(true);
    expect(result.doc.slice(result.cursor).startsWith("猫である。")).toBe(true);
  });

  it("an existing blank line is reused, not stacked", () => {
    expect(insert("一行目\n\n|二行目").doc).toBe(
      "一行目\n\n<!-- pagebreak -->\n\n二行目"
    );

    const onBlank = insert("一行目\n|\n二行目");
    expect(onBlank.doc).not.toMatch(/\n\n\n/);
    expect(pageBreaksAreStandalone(onBlank.doc)).toBe(true);
  });

  it("with a selection, the selected text is kept and the directive goes after it", () => {
    const result = insert("前[選択本文]後");
    expect(result.doc).toBe("前選択本文\n\n<!-- pagebreak -->\n\n後");
    expect(pageBreaksAreStandalone(result.doc)).toBe(true);
  });

  it("one Undo restores the document, and Redo re-applies it", () => {
    let current = stateFrom("吾輩は猫である。|");
    const target = {
      get state() {
        return current;
      },
      dispatch: (transaction: TransactionSpec) => {
        current = current.update(transaction).state;
      }
    };

    target.dispatch(markdownPageBreakInsertionTransactionSpec(current));
    const inserted = current.doc.toString();
    expect(inserted).toContain(PAGE_BREAK_MARKUP);

    expect(undo(target as never)).toBe(true);
    expect(current.doc.toString()).toBe("吾輩は猫である。");
    expect(redo(target as never)).toBe(true);
    expect(current.doc.toString()).toBe(inserted);
  });
});

describe("page break applicability (#733)", () => {
  const ts = "2026-10-05T00:00:00.000Z";
  const ID = "018f4b8c-7a2b-7c3d-8e4f-100000000001";
  const markdown = createMarkdownCurrentEditor(
    createProjectDocument(
      { relativePath: "chapter.md", name: "chapter.md" } as ProjectDocument,
      "本文"
    )
  );
  const plainText = createMarkdownCurrentEditor(
    createProjectDocument(
      { relativePath: "memo.txt", name: "memo.txt" } as ProjectDocument,
      "本文"
    )
  );
  const glossary = createGlossaryDescriptionCurrentEditor({
    id: ID,
    description: "説明",
    atoms: [],
    tags: [],
    createdAt: ts,
    updatedAt: ts
  } as GlossaryEntry);
  const open = { isEditorAreaSpecialTabActive: false, isReadOnly: false };
  const gate = (editor: CurrentEditor | null, state = open) =>
    canInsertPageBreakInEditor(editor, state);

  it("is enabled for an editable Markdown document only", () => {
    expect(gate(markdown)).toBe(true);
    expect(gate(createMarkdownCurrentEditor(createUntitledDocument()))).toBe(true);
    expect(gate(plainText)).toBe(false);
    expect(gate(markdown, { ...open, isReadOnly: true })).toBe(false);
    expect(gate(glossary)).toBe(false);
    expect(gate(markdown, { ...open, isEditorAreaSpecialTabActive: true })).toBe(false);
    expect(gate(glossary, { ...open, isEditorAreaSpecialTabActive: true })).toBe(false);
    expect(gate(null)).toBe(false);
    expect(gate(createProjectImageCurrentEditor("a.png"))).toBe(false);
  });

  it("App feeds Toolbar and Command Registry from the same value", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8");

    expect(source).toContain("canInsertPageBreak = canInsertPageBreakInEditor(");
    expect(source).toContain(
      "canInsertPageBreakCommandRef.current = () => canInsertPageBreak;"
    );
    expect(source).toContain("canInsertPageBreak={canInsertPageBreak}");
    expect(source).toContain("onInsertPageBreak={handleInsertPageBreak}");
  });
});

describe("editor.markdown.insertPageBreak command (#733)", () => {
  function controllerWith(overrides: Record<string, unknown>) {
    return new Proxy(
      { ...overrides },
      {
        get: (target, key) =>
          key in target
            ? (target as Record<string | symbol, unknown>)[key]
            : String(key).startsWith("can")
              ? () => true
              : () => undefined
      }
    ) as never;
  }

  function registry(
    overrides: Record<string, unknown>,
    language: "ja" | "en" = "ja"
  ) {
    const dictionary = (language === "ja" ? jaTranslations : enTranslations) as Record<
      string,
      string
    >;
    const commandRegistry = new CommandRegistry();
    for (const command of createEditorCommands(
      controllerWith(overrides),
      createEditorCommandTitles(((key: string) => dictionary[key] ?? key) as never)
    )) {
      commandRegistry.register(command as never);
    }
    return commandRegistry;
  }

  it("is registered as a formatting command with title, description and no shortcut", () => {
    expect(editorCommandIds.insertPageBreak).toBe("editor.markdown.insertPageBreak");
    const command = registry({}).get(editorCommandIds.insertPageBreak)!;

    expect(command.title).toBe("改ページを挿入");
    expect(command.description).toContain("<!-- pagebreak -->");
    expect(command.category).toBe("formatting");
    expect(registry({}, "en").get(editorCommandIds.insertPageBreak)!.title).toBe(
      "Insert Page Break"
    );
    expect(readFileSync("src/shared/keybindings/defaults.ts", "utf8")).not.toContain(
      "insertPageBreak"
    );
  });

  it("runs the controller when applicable and refuses otherwise", async () => {
    const insertPageBreak = vi.fn();
    await registry({ insertPageBreak, canInsertPageBreak: () => true }).execute(
      editorCommandIds.insertPageBreak,
      { source: "commandPalette" }
    );
    expect(insertPageBreak).toHaveBeenCalledTimes(1);

    const blocked = vi.fn();
    await expect(
      registry({ insertPageBreak: blocked, canInsertPageBreak: () => false }).execute(
        editorCommandIds.insertPageBreak,
        { source: "commandPalette" }
      )
    ).rejects.toThrow();
    expect(blocked).not.toHaveBeenCalled();
  });

  it("is listed in the Command Palette group, after Callout", () => {
    const commands = registry({}).list();
    const callout = commands.find((c) => c.id === editorCommandIds.insertCallout)!;
    const pageBreak = commands.find((c) => c.id === editorCommandIds.insertPageBreak)!;

    expect(pageBreak).toBeDefined();
    expect(pageBreak.paletteOrder!).toBeGreaterThan(callout.paletteOrder!);
  });

  it("MarkdownEditor exposes insertPageBreak and refuses a read-only editor", () => {
    const source = readFileSync("src/renderer/MarkdownEditor.tsx", "utf8");
    const start = source.indexOf("insertPageBreak: (): boolean => {");

    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, start + 200)).toContain("readOnlyRef.current");
  });
});
