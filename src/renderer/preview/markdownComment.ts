import type MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";

type StateBlock = Parameters<
  Parameters<InstanceType<typeof MarkdownIt>["block"]["ruler"]["push"]>[1]
>[0];

/**
 * #733: Pergamum-defined, standalone-line Markdown comments.
 *
 *   <!-- memo -->        a comment: kept in the source, never rendered
 *   <!-- pagebreak -->   a directive: never rendered in Preview, a forced page
 *                        break in static export (HTML / PDF)
 *
 * Only a line made of a single `<!-- ... -->` (open and close on the same
 * line, trailing whitespace allowed) is recognised. It is a markdown-it BLOCK
 * rule, so the usual Markdown contexts win: indented code, fenced code and
 * inline code never reach it, and inline `text <!-- x --> text` is untouched.
 * `html: false` stays: nothing else about raw HTML changes, and the tokens
 * below render to either nothing or a fixed, Pergamum-authored element.
 */

import {
  PAGE_BREAK_DIRECTIVE_NAME,
  PAGE_BREAK_MARKUP
} from "../../shared/markdownPageBreakMarkup";

export { PAGE_BREAK_DIRECTIVE_NAME, PAGE_BREAK_MARKUP };
export const PAGE_BREAK_CLASS_NAME = "pergamum-pagebreak";

/** The one page-break element every export notation emits. */
export const PAGE_BREAK_ELEMENT_HTML = `<div class="${PAGE_BREAK_CLASS_NAME}" aria-hidden="true"></div>`;

export const MARKDOWN_COMMENT_TOKEN = "pergamum_comment";
export const MARKDOWN_PAGE_BREAK_TOKEN = "pergamum_pagebreak";

/** A whole line that is exactly one same-line HTML comment. */
const standaloneCommentLine = /^<!--((?:(?!-->)[\s\S])*)-->[ \t]*$/;

/**
 * The inner text of a standalone comment line, or `null` when the line is not
 * one. Shared with Character Count so both recognise the same syntax.
 */
export function standaloneCommentContent(line: string): string | null {
  const match = standaloneCommentLine.exec(line.trim());
  return match ? match[1] : null;
}

export function isPageBreakDirectiveContent(content: string): boolean {
  return content.trim() === PAGE_BREAK_DIRECTIVE_NAME;
}

/** Whether `source` (a line or a one-line html block) is `<!-- pagebreak -->`. */
export function isPageBreakDirectiveSource(source: string): boolean {
  const content = standaloneCommentContent(source);
  return content !== null && isPageBreakDirectiveContent(content);
}

function commentBlockRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean
): boolean {
  // Markdown's code context wins: 4+ columns of indentation is an indented
  // code block, never a comment.
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const start = state.bMarks[startLine] + state.tShift[startLine];
  const content = standaloneCommentContent(
    state.src.slice(start, state.eMarks[startLine])
  );

  if (content === null) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push(
    isPageBreakDirectiveContent(content)
      ? MARKDOWN_PAGE_BREAK_TOKEN
      : MARKDOWN_COMMENT_TOKEN,
    "",
    0
  );
  token.map = [startLine, startLine + 1];
  token.block = true;
  token.content = content;
  state.line = startLine + 1;

  return true;
}

export interface MarkdownCommentPluginOptions {
  /**
   * Decides, per render call, whether `<!-- pagebreak -->` becomes the
   * page-break element (static export) or renders nothing (Preview).
   */
  readonly emitsPageBreakElement: (env: unknown) => boolean;
}

export function markdownItPergamumComments(
  md: InstanceType<typeof MarkdownIt>,
  options: MarkdownCommentPluginOptions
): void {
  md.block.ruler.before("paragraph", MARKDOWN_COMMENT_TOKEN, commentBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"]
  });

  md.renderer.rules[MARKDOWN_COMMENT_TOKEN] = () => "";
  md.renderer.rules[MARKDOWN_PAGE_BREAK_TOKEN] = (_tokens: Token[], _idx: number, _options: unknown, env: unknown) =>
    options.emitsPageBreakElement(env)
      ? `${PAGE_BREAK_ELEMENT_HTML}\n`
      : "";
}

/**
 * Export CSS: invisible on screen (an empty block), a forced break in print /
 * PDF. Same `break-before` + legacy `page-break-before` pair the export
 * already uses for the file-structure TOC.
 */
export const markdownPageBreakExportCss = [
  `    .${PAGE_BREAK_CLASS_NAME} {`,
  `      break-before: page;`,
  `      page-break-before: always;`,
  `    }`
].join("\n");
