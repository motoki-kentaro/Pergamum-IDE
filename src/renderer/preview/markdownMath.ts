import type MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import katex from "katex";

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type StateBlock = Parameters<
  Parameters<MarkdownItInstance["block"]["ruler"]["push"]>[1]
>[0];
type StateInline = Parameters<
  Parameters<MarkdownItInstance["inline"]["ruler"]["push"]>[1]
>[0];

/**
 * #566 / #743: Pergamum's own markdown-it integration for KaTeX math.
 *
 *   $x^2$            inline math
 *   $$x^2$$          display math inside a paragraph
 *   $$ x^2 $$        display math block on a single line
 *   $$               display math block over several lines
 *   \frac{a}{b}
 *   $$
 *
 * Delimiters follow the pandoc convention: an inline `$` must have a
 * non-space character right after the opening `$` and right before the
 * closing `$`, and the closing `$` must not be followed by a digit, so prose
 * such as `$100 and $200` stays plain text. `\$` is markdown-it's ordinary
 * escape and never opens or closes math.
 *
 * Math is rendered with KaTeX's public `renderToString` API only, from the one
 * `katex` dependency that also supplies the Preview / export CSS and fonts, so
 * the generated HTML and its stylesheet are always the same KaTeX generation.
 * `throwOnError: false` makes KaTeX emit its own escaped `katex-error` span for
 * invalid TeX; any other failure is caught here and rendered as an escaped
 * error span too, so math never breaks the rest of the Preview. `trust` stays
 * at KaTeX's default (`false`): `\href`, `\url`, `\htmlClass` etc. are not
 * honoured.
 */

export const MATH_INLINE_RULE_NAME = "math_inline";
export const MATH_BLOCK_RULE_NAME = "math_block";

/** Parser rule names, for enabling / disabling math per render target. */
export const MATH_RULE_NAMES = [MATH_INLINE_RULE_NAME, MATH_BLOCK_RULE_NAME] as const;

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

function isWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Whether the character at `pos` is preceded by an odd run of backslashes. */
function isBackslashEscaped(src: string, pos: number): boolean {
  let backslashes = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === BACKSLASH; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

/**
 * Position of the closing delimiter for math opened at `contentStart`, or -1.
 * Single `$` applies the pandoc spacing / digit rules; `$$` only needs an
 * unescaped closing `$$`.
 */
function findClosingDelimiter(
  src: string,
  contentStart: number,
  max: number,
  delimiter: "$" | "$$"
): number {
  let pos = src.indexOf(delimiter, contentStart);

  while (pos !== -1 && pos + delimiter.length <= max) {
    const acceptable =
      pos > contentStart &&
      !isBackslashEscaped(src, pos) &&
      (delimiter === "$$" ||
        (!isWhitespaceCode(src.charCodeAt(pos - 1)) &&
          !isDigitCode(src.charCodeAt(pos + 1))));

    if (acceptable) {
      return pos;
    }
    pos = src.indexOf(delimiter, pos + 1);
  }

  return -1;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const { src, pos: start, posMax } = state;

  if (src.charCodeAt(start) !== DOLLAR) {
    return false;
  }

  const display = src.charCodeAt(start + 1) === DOLLAR;
  const delimiter = display ? "$$" : "$";
  const contentStart = start + delimiter.length;

  if (
    contentStart >= posMax ||
    (!display && isWhitespaceCode(src.charCodeAt(contentStart)))
  ) {
    return false;
  }

  const closing = findClosingDelimiter(src, contentStart, posMax, delimiter);
  if (closing === -1) {
    return false;
  }

  const content = src.slice(contentStart, closing);
  if (content.trim() === "") {
    return false;
  }

  if (!silent) {
    const token = state.push(MATH_INLINE_RULE_NAME, "math", 0);
    token.markup = delimiter;
    token.content = content;
    token.meta = { display };
  }

  state.pos = closing + delimiter.length;
  return true;
}

function mathBlockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean
): boolean {
  // 4+ columns of indentation is an indented code block, never math.
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const start = state.bMarks[startLine] + state.tShift[startLine];
  const firstLine = state.src.slice(start, state.eMarks[startLine]).trimEnd();

  if (!firstLine.startsWith("$$")) {
    return false;
  }

  const afterOpening = firstLine.slice(2);
  const contentLines: string[] = [];
  let lastLine = startLine;

  if (afterOpening.endsWith("$$")) {
    contentLines.push(afterOpening.slice(0, -2));
  } else {
    contentLines.push(afterOpening);
    let closed = false;

    for (let line = startLine + 1; line < endLine; line++) {
      const lineStart = state.bMarks[line] + state.tShift[line];
      const lineEnd = state.eMarks[line];

      // A non-empty line dedented out of the current container (list item,
      // blockquote) ends the search: the block was never closed.
      if (lineStart < lineEnd && state.sCount[line] < state.blkIndent) {
        break;
      }

      const text = state.src.slice(lineStart, lineEnd).trimEnd();
      if (text.endsWith("$$") && !isBackslashEscaped(text, text.length - 2)) {
        contentLines.push(text.slice(0, -2));
        lastLine = line;
        closed = true;
        break;
      }
      contentLines.push(text);
    }

    if (!closed) {
      return false;
    }
  }

  const content = contentLines.join("\n").trim();
  if (content === "") {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push(MATH_BLOCK_RULE_NAME, "math", 0);
  token.block = true;
  token.markup = "$$";
  token.content = content;
  token.map = [startLine, lastLine + 1];
  state.line = lastLine + 1;

  return true;
}

function renderMath(
  md: MarkdownItInstance,
  latex: string,
  displayMode: boolean
): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false });
  } catch (error) {
    return `<span class="katex-error" title="${md.utils.escapeHtml(latex)}">${md.utils.escapeHtml(String(error))}</span>`;
  }
}

export function markdownItMath(md: MarkdownItInstance): void {
  md.inline.ruler.after("escape", MATH_INLINE_RULE_NAME, mathInlineRule);
  md.block.ruler.before("fence", MATH_BLOCK_RULE_NAME, mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"]
  });

  md.renderer.rules[MATH_INLINE_RULE_NAME] = (tokens: Token[], idx: number) => {
    const token = tokens[idx];
    const display = (token.meta as { display?: boolean } | null)?.display === true;
    return renderMath(md, token.content, display);
  };

  // `data-source-line` (#503) is set on the token by the core
  // `source_line_anchors` rule; carry it onto the block wrapper so preview
  // scroll-sync / jump-to-source (#504) work for display math.
  md.renderer.rules[MATH_BLOCK_RULE_NAME] = (tokens: Token[], idx: number) => {
    const token = tokens[idx];
    const sourceLine = token.attrGet("data-source-line");
    const sourceLineAttribute =
      sourceLine != null
        ? ` data-source-line="${md.utils.escapeHtml(String(sourceLine))}"`
        : "";
    return `<div class="katex-block"${sourceLineAttribute}>${renderMath(md, token.content, true)}</div>\n`;
  };
}
