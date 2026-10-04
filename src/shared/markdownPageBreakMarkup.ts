/**
 * #733: the Pergamum page-break directive and its insertion text.
 *
 * `<!-- pagebreak -->` is a standalone-line Markdown comment with a reserved
 * meaning (see `renderer/preview/markdownComment.ts`): hidden in Preview, a
 * forced page break in static export.
 */

export const PAGE_BREAK_DIRECTIVE_NAME = "pagebreak";
export const PAGE_BREAK_MARKUP = `<!-- ${PAGE_BREAK_DIRECTIVE_NAME} -->`;

export interface PageBreakInsertionResult {
  readonly text: string;
  /** Offset, from the start of `text`, where the collapsed cursor lands: the
   *  first column of the line after the blank line that follows the directive. */
  readonly selectionOffsetFromInsertStart: number;
}

/**
 * The directive plus just enough newlines that exactly one blank line follows
 * it: `existingNewlinesAfter` is how many `\n` already sit at the insertion
 * point, so a blank line that is already there is reused, never stacked. The
 * newline BEFORE the directive is the editor's block-insertion padding.
 */
export function buildPageBreakInsertion(
  existingNewlinesAfter = 0
): PageBreakInsertionResult {
  const ownNewlines = Math.max(0, 2 - existingNewlinesAfter);

  return {
    text: PAGE_BREAK_MARKUP + "\n".repeat(ownNewlines),
    selectionOffsetFromInsertStart: PAGE_BREAK_MARKUP.length + 2
  };
}
