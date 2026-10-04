import {
  currentDocumentContent,
  isMarkdownCurrentDocument
} from "./currentDocument";
import type { CurrentEditor } from "./currentEditor";
import type { CharacterCountDocumentFormat } from "./characterCount";

/**
 * #727: which text the Editor header character count reads. Resolved once
 * from the active editor so the single debounced count pipeline serves every
 * countable surface:
 * - `document`: a Markdown or Plain Text (.txt) document (`kind: "markdown"`).
 *   Only this surface also feeds Document Metrics.
 * - `glossaryDescription`: the live `draft.description` (saved or not),
 *   counted as Markdown. Editor header only — never Document Metrics.
 */
export interface CharacterCountSource {
  readonly surface: "document" | "glossaryDescription";
  readonly content: string;
  readonly format: CharacterCountDocumentFormat;
}

export function resolveCharacterCountSource(
  editor: CurrentEditor | null | undefined,
  isEditorAreaSpecialTabActive: boolean
): CharacterCountSource | null {
  if (isEditorAreaSpecialTabActive || !editor) {
    return null;
  }

  if (editor.kind === "markdown") {
    return {
      surface: "document",
      content: currentDocumentContent(editor.document),
      // Plain Text keeps only the format-neutral excludes.
      format: isMarkdownCurrentDocument(editor.document)
        ? "markdown"
        : "plainText"
    };
  }

  if (editor.kind === "glossaryDescription") {
    return {
      surface: "glossaryDescription",
      content: editor.draft.description,
      format: "markdown"
    };
  }

  return null;
}

export interface KeyedCharacterCount {
  readonly documentKey: string;
  readonly count: number;
}

/**
 * The count for the CURRENT surface only. A result computed for a previous
 * surface (its debounce completed after the user switched tabs) carries a
 * different `documentKey` and resolves to `null`.
 */
export function currentCharacterCount(
  state: KeyedCharacterCount | null,
  activeDocumentKey: string | null
): number | null {
  return activeDocumentKey !== null && state?.documentKey === activeDocumentKey
    ? state.count
    : null;
}
