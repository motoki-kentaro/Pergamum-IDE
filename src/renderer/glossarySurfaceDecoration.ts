import {
  normalizeGlossaryRgbHex,
  primaryGlossaryTag,
  type GlossaryEntry
} from "../shared/glossary";
import { autoGlossaryTagForegroundRgb } from "../shared/glossaryTagColor";
import {
  defaultDocumentMapSettings,
  normalizeDocumentMapColor
} from "../shared/documentMapSettings";
import type {
  GlossarySurfaceIndex,
  GlossarySurfaceTextMatch
} from "../shared/glossarySurfaceMatching";
import { matchGlossarySurfacesInText } from "../shared/glossarySurfaceMatching";

export type GlossarySurfaceDecorationSegment =
  | { kind: "plain"; text: string }
  | { kind: "match"; match: GlossarySurfaceTextMatch };

export interface GlossarySurfaceDecorationAncestor {
  readonly tagName: string;
  readonly parentElement: GlossarySurfaceDecorationAncestor | null;
  /** DOM `Element.classList` (optional so plain test doubles stay valid). */
  readonly classList?: { contains(token: string): boolean };
}

// #568: a callout's title row (icon + "補足" / "注意" ... label) is UI /
// structural chrome, not manuscript text, so it is never glossary-decorated.
// `.markdown-callout-body` is manuscript text and stays decorated.
const skippedDecorationAncestorClassNames = [
  "markdown-callout-title",
  "markdown-callout-label",
  "markdown-callout-icon"
] as const;

function hasSkippedDecorationClassName(
  element: GlossarySurfaceDecorationAncestor
): boolean {
  const classList = element.classList;
  return (
    classList !== undefined &&
    skippedDecorationAncestorClassNames.some((className) =>
      classList.contains(className)
    )
  );
}

// #564: SVG is defensive — Mermaid diagram SVGs are inserted asynchronously,
// strictly after this module's one-time decoration pass already ran (see
// markdownMermaidRendering.ts's module doc comment), so decoration never
// actually reaches an SVG's <text> content today. Kept anyway: wrapping
// arbitrary <span> markup around SVG <text> content would be invalid and
// would visibly break a diagram whose node label happens to match a
// glossary term, and this guards against that even if the render/decorate
// ordering ever changes.
const skippedDecorationAncestorTagNames = new Set(["A", "CODE", "PRE", "SVG"]);

export function isGlossarySurfaceDecorationSkipTagName(
  tagName: string
): boolean {
  return skippedDecorationAncestorTagNames.has(tagName.toUpperCase());
}

export function shouldSkipGlossarySurfaceDecorationTextNode(
  parentElement: GlossarySurfaceDecorationAncestor | null
): boolean {
  let element = parentElement;

  while (element) {
    if (
      isGlossarySurfaceDecorationSkipTagName(element.tagName) ||
      hasSkippedDecorationClassName(element)
    ) {
      return true;
    }

    element = element.parentElement;
  }

  return false;
}

export function buildGlossarySurfaceDecorationSegments(
  text: string,
  index: GlossarySurfaceIndex
): GlossarySurfaceDecorationSegment[] {
  const matches = matchGlossarySurfacesInText(text, index);

  if (matches.length === 0) {
    return text.length > 0 ? [{ kind: "plain", text }] : [];
  }

  const segments: GlossarySurfaceDecorationSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.range.start > cursor) {
      segments.push({
        kind: "plain",
        text: text.slice(cursor, match.range.start)
      });
    }

    segments.push({ kind: "match", match });
    cursor = match.range.end;
  }

  if (cursor < text.length) {
    segments.push({
      kind: "plain",
      text: text.slice(cursor)
    });
  }

  return segments;
}

export interface GlossaryDecorationColors {
  readonly backgroundRgb: string;
  readonly foregroundRgb: string;
}

/** The container variable holding the highlight alpha (a number, 0..1). */
export const GLOSSARY_HIGHLIGHT_OPACITY_VAR = "--glossary-highlight-opacity";

/**
 * #731: the one place a stored `#rrggbb` is converted for a translucent
 * background: its `"r g b"` channels. The stored colour is never rewritten;
 * styles.css composes `rgb(<channels> / var(--glossary-highlight-opacity))`, so
 * changing `preview.glossaryHighlightOpacity` repaints every decoration without
 * re-decorating. Foreground never gets alpha.
 */
export function glossaryDecorationRgbChannels(backgroundRgb: string): string {
  const hex = normalizeGlossaryRgbHex(backgroundRgb).slice(1);
  const [r, g, b] = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  );

  return `${r} ${g} ${b}`;
}

/** The value for { GLOSSARY_HIGHLIGHT_OPACITY_VAR}: clamped to 0..1. */
export function glossaryHighlightOpacityValue(opacity: number): string {
  const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;

  return String(Number(clamped.toFixed(4)));
}

/**
 * #731: Preview decoration colours for one entry. An entry with tags uses its
 * PRIMARY (first-assigned, `tags[0]`) tag's stored `backgroundRgb` /
 * `foregroundRgb` pair verbatim (no alpha, no Document Map visibility
 * adjustment). An entry without tags returns `null`: the caller paints it with
 * the `documentMap.glossaryFallbackColor` pair (see
 * {@link glossaryFallbackDecorationColors}).
 */
export function glossaryDecorationColorsForEntry(
  entry: Pick<GlossaryEntry, "tags"> | undefined
): GlossaryDecorationColors | null {
  const primaryTag = entry ? primaryGlossaryTag(entry) : null;

  return primaryTag
    ? {
        backgroundRgb: primaryTag.backgroundRgb,
        foregroundRgb: primaryTag.foregroundRgb
      }
    : null;
}

/**
 * The untagged-entry pair: `documentMap.glossaryFallbackColor` as the
 * background, with the foreground derived by the same YIQ policy that seeds a
 * new Glossary tag's foreground.
 */
export function glossaryFallbackDecorationColors(
  fallbackColor: string | undefined
): GlossaryDecorationColors {
  const backgroundRgb =
    normalizeDocumentMapColor(fallbackColor) ??
    defaultDocumentMapSettings().glossaryFallbackColor;

  return {
    backgroundRgb,
    foregroundRgb: autoGlossaryTagForegroundRgb(backgroundRgb)
  };
}
