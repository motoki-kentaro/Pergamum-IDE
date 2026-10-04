import { isMarkdownCurrentDocument } from "./currentDocument";
import type { CurrentEditor } from "./currentEditor";

/**
 * #733: where `editor.markdown.insertPageBreak` (and its toolbar button) is
 * available — the single source of truth, read by both the Command Registry
 * and the Toolbar.
 *
 * A page break is PDF body-text layout, so it applies to an editable Markdown
 * DOCUMENT only. Not `.txt`, not a read-only document, not a special tab, not
 * a Glossary Description (a Markdown editing surface, but never a document
 * body — it has no `CurrentDocument` and is exported through its own path).
 */
export function canInsertPageBreakInEditor(
  editor: CurrentEditor | null | undefined,
  state: {
    readonly isEditorAreaSpecialTabActive: boolean;
    readonly isReadOnly: boolean;
  }
): boolean {
  return (
    !state.isEditorAreaSpecialTabActive &&
    !state.isReadOnly &&
    editor?.kind === "markdown" &&
    isMarkdownCurrentDocument(editor.document)
  );
}
