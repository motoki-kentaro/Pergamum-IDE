import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { GlossaryEntry, GlossaryEntryId } from "../shared/glossary";
import {
  isNarouPreviewRenderer,
  type PreviewRendererId
} from "../shared/settings";
import type { Translate } from "../shared/i18n";
import { getCatalogDefaultValue } from "../shared/settingsCatalog";
import {
  isAmbiguousGlossarySurfaceTextMatch,
  type GlossarySurfaceIndex
} from "../shared/glossarySurfaceMatching";
import { durationSincePerformanceMark } from "./debugLog";
import {
  buildGlossarySurfaceDecorationSegments,
  GLOSSARY_HIGHLIGHT_OPACITY_VAR,
  glossaryDecorationRgbChannels,
  glossaryDecorationColorsForEntry,
  glossaryFallbackDecorationColors,
  glossaryHighlightOpacityValue,
  shouldSkipGlossarySurfaceDecorationTextNode
} from "./glossarySurfaceDecoration";
import { GlossaryHoverCard } from "./GlossaryHoverCard";
import { buildGlossaryHoverCardContents } from "./glossaryHoverCardContent";
import { renderMermaidDiagramsInContainer } from "./preview/markdownMermaidRendering";

export interface GlossaryPreviewDecoratorProps {
  previewHtml: string;
  /**
   * #731: the index used for decoration. The `preview.glossaryAnnotations`
   * setting is applied by the caller handing in `emptyGlossarySurfaceIndex`
   * when it is OFF, so nothing is matched or wrapped at all.
   */
  surfaceIndex: GlossarySurfaceIndex;
  previewRenderer?: PreviewRendererId;
  narouMarkText?: string;
  /** #731: entries the hover card reads (atoms + tags) for decorated matches. */
  glossaryEntries?: readonly GlossaryEntry[];
  /** #731: `documentMap.glossaryFallbackColor` — paints untagged entries. */
  glossaryFallbackColor?: string;
  /** #731: `preview.glossaryHighlightOpacity` — background alpha of every decoration. */
  glossaryHighlightOpacity?: number;
  /**
   * #564: required only to localize the Mermaid empty/error inline
   * messages. Mermaid diagrams are scanned and rendered from this same
   * effect ONLY when `previewRenderer === "markdown"` — Narou / Kakuyomu
   * (horizontal and vertical) and Aozora previews, which reuse this same
   * component, are unaffected.
   */
  translate: Translate;
  /** In-flight document-open correlation id (#152), or null when idle. */
  documentOpenId: string | null;
  /**
   * `performance.now()` mark from the start of this document's preview
   * render (#154) — the same boundary `previewRender.completed` uses, so
   * `previewDom.committed`'s duration stays comparable to it.
   */
  previewRenderStartedAt: number;
  /** Fired once after the preview HTML has been written into the live DOM. */
  onPreviewDomCommitted: (
    documentOpenId: string,
    durationMs: number,
    previewNodeCount: number
  ) => void;
  /** Fired once after decoratePreviewContainer finishes. */
  onPreviewDecorationCompleted: (
    documentOpenId: string,
    durationMs: number,
    visitedTextNodeCount: number,
    decoratedNodeCount: number,
    matchCount: number
  ) => void;
  /**
   * Fired once from a `requestAnimationFrame` callback scheduled right
   * after decoration finishes (#154 follow-up) — see the effect below for
   * what this proxy does and does not guarantee.
   */
  onPreviewFrameObserved: (documentOpenId: string, durationMs: number) => void;
  /** #503: callback when the preview container element mounts or unmounts. */
  onPreviewContainerMount?: (container: HTMLElement | null) => void;
  /** #503: callback when preview HTML is committed into DOM. */
  onPreviewContentCommitted?: (container: HTMLElement) => void;
}

interface PreviewDecorationStats {
  visitedTextNodeCount: number;
  decoratedNodeCount: number;
  matchCount: number;
}

// Body-text glossary matches are wrapped in a decoration span (when
// `preview.glossaryAnnotations` is ON, #731) carrying the candidate entry ids,
// which the hover card (below) resolves against the current entries.
function replaceTextNodeWithDecorationSegments(
  textNode: Text,
  segments: ReturnType<typeof buildGlossarySurfaceDecorationSegments>,
  entriesById: ReadonlyMap<GlossaryEntryId, GlossaryEntry>
): number {
  const parentNode = textNode.parentNode;
  const matchSegmentCount = segments.filter(
    (segment) => segment.kind === "match"
  ).length;

  if (!parentNode || matchSegmentCount === 0) {
    return 0;
  }

  const fragment = textNode.ownerDocument.createDocumentFragment();

  for (const segment of segments) {
    if (segment.kind === "plain") {
      fragment.appendChild(
        textNode.ownerDocument.createTextNode(segment.text)
      );
      continue;
    }

    const span = textNode.ownerDocument.createElement("span");
    span.className = "glossarySurfaceDecoration";
    span.textContent = segment.match.matchedText;
    span.dataset.glossarySurface = segment.match.matchedText;
    span.dataset.glossaryAmbiguous =
      isAmbiguousGlossarySurfaceTextMatch(segment.match) ? "true" : "false";
    span.dataset.glossaryEntryIds = [
      ...new Set(segment.match.candidates.map((candidate) => candidate.entryId))
    ].join(" ");
    // Colour: the first candidate entry's primary-tag pair, verbatim. An entry
    // without tags is marked instead and painted from the container's
    // fallback CSS variables (so the Document Map fallback colour applies live).
    const colors = glossaryDecorationColorsForEntry(
      entriesById.get(segment.match.candidates[0]?.entryId ?? "")
    );
    if (colors) {
      span.style.setProperty(
        "--glossary-decoration-rgb",
        glossaryDecorationRgbChannels(colors.backgroundRgb)
      );
      span.style.color = colors.foregroundRgb;
    } else {
      span.dataset.glossaryTagless = "true";
    }
    fragment.appendChild(span);
  }

  parentNode.replaceChild(fragment, textNode);

  return matchSegmentCount;
}

function decoratePreviewContainer(
  container: HTMLElement,
  surfaceIndex: GlossarySurfaceIndex,
  entries: readonly GlossaryEntry[]
): PreviewDecorationStats {
  if (surfaceIndex.entries.length === 0) {
    return { visitedTextNodeCount: 0, decoratedNodeCount: 0, matchCount: 0 };
  }

  const textNodes: Text[] = [];
  const treeWalker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT
  );
  let currentNode = treeWalker.nextNode();

  while (currentNode) {
    if (
      currentNode instanceof Text &&
      !shouldSkipGlossarySurfaceDecorationTextNode(
        currentNode.parentElement
      )
    ) {
      textNodes.push(currentNode);
    }

    currentNode = treeWalker.nextNode();
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  let decoratedNodeCount = 0;
  let matchCount = 0;

  for (const textNode of textNodes) {
    const matchSegmentCount = replaceTextNodeWithDecorationSegments(
      textNode,
      buildGlossarySurfaceDecorationSegments(
        textNode.textContent ?? "",
        surfaceIndex
      ),
      entriesById
    );

    if (matchSegmentCount > 0) {
      decoratedNodeCount += 1;
      matchCount += matchSegmentCount;
    }
  }

  return { visitedTextNodeCount: textNodes.length, decoratedNodeCount, matchCount };
}

const noGlossaryEntries: readonly GlossaryEntry[] = [];
const decorationSelector = ".glossarySurfaceDecoration";
const hoverCardMargin = 8;
const hoverCardWidth = 320;
const hoverCardOffset = 6;

interface GlossaryHoverState {
  readonly entryIds: readonly GlossaryEntryId[];
  readonly anchorRect: DOMRect;
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

// Fixed-position (out of flow), so showing the card never reflows the Preview.
// It opens below the term, or above it when the term is in the lower half.
function hoverCardLayerStyle(anchorRect: DOMRect): CSSProperties {
  const left = clamp(
    anchorRect.left,
    hoverCardMargin,
    window.innerWidth - hoverCardWidth - hoverCardMargin
  );

  return anchorRect.bottom > window.innerHeight / 2
    ? { left, bottom: window.innerHeight - anchorRect.top + hoverCardOffset }
    : { left, top: anchorRect.bottom + hoverCardOffset };
}

export function GlossaryPreviewDecorator({
  previewHtml,
  surfaceIndex,
  previewRenderer = "markdown",
  narouMarkText,
  glossaryEntries = noGlossaryEntries,
  glossaryFallbackColor,
  glossaryHighlightOpacity = getCatalogDefaultValue(
    "preview.glossaryHighlightOpacity"
  ),
  translate,
  documentOpenId,
  previewRenderStartedAt,
  onPreviewDomCommitted,
  onPreviewDecorationCompleted,
  onPreviewFrameObserved,
  onPreviewContainerMount,
  onPreviewContentCommitted
}: GlossaryPreviewDecoratorProps): JSX.Element {
  const previewRef = useRef<HTMLElement | null>(null);
  const [hoverState, setHoverState] = useState<GlossaryHoverState | null>(null);
  const onPreviewContainerMountRef = useRef(onPreviewContainerMount);
  const onPreviewContentCommittedRef = useRef(onPreviewContentCommitted);
  // #564: incremented once per live preview DOM commit (below), so an
  // async mermaid.render() from an older commit can be identified by its id
  // alone — the actual staleness guard is `container.isConnected`
  // (see markdownMermaidRendering.ts), not a comparison against this ref.
  const mermaidGenerationRef = useRef(0);
  useLayoutEffect(() => {
    onPreviewContainerMountRef.current = onPreviewContainerMount;
    onPreviewContentCommittedRef.current = onPreviewContentCommitted;
  }, [onPreviewContainerMount, onPreviewContentCommitted]);
  // Guards against React StrictMode's dev-only double layout-effect
  // invocation, and against re-firing for the same open on a later,
  // unrelated re-run of this effect — mirrors the reportedDocumentOpenIdRef
  // pattern in EditorSurface.tsx (#152). Each ref is keyed on its own event
  // so a slow decoration pass reporting late can't suppress the (already
  // reported) DOM-commit event or vice versa.
  const reportedPreviewDomCommitDocumentOpenIdRef = useRef<string | null>(
    null
  );
  const reportedPreviewDecorationDocumentOpenIdRef = useRef<string | null>(
    null
  );
  // Guards the deferred (requestAnimationFrame) report specifically: gating
  // is checked when the callback actually fires, not when the frame is
  // requested, so a React StrictMode double-invocation (which schedules,
  // then immediately cancels-via-cleanup, then schedules again) still
  // reports exactly once from whichever request survives to fire — see the
  // effect below.
  const reportedPreviewFrameDocumentOpenIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previewElement = previewRef.current;

    onPreviewContainerMountRef.current?.(previewElement);
    if (!previewElement) {
      return;
    }
    previewElement.innerHTML = previewHtml;
    onPreviewContentCommittedRef.current?.(previewElement);

    // #564: Mermaid placeholders only ever appear in the HTML when this
    // render was for "markdown" (horizontal) preview — the fence rule
    // itself is gated the same way — but this check is kept here too as a
    // second, independent guard against ever scanning a Narou / Kakuyomu /
    // Aozora container. Synchronous and fast when there is nothing to do
    // (querySelectorAll on an empty match set). mermaid.render() is async,
    // so its results always arrive strictly after the synchronous Glossary
    // decoration pass below completes — see markdownMermaidRendering.ts's
    // module doc comment for why that ordering makes SVG output safe from
    // decoration without needing to special-case it here.
    if (previewRenderer === "markdown") {
      mermaidGenerationRef.current += 1;
      renderMermaidDiagramsInContainer(
        previewElement,
        mermaidGenerationRef.current,
        {
          emptyMessage: translate("preview.mermaid.emptyMessage"),
          errorMessage: translate("preview.mermaid.errorMessage"),
          errorHint: translate("preview.mermaid.errorHint"),
          showDetailsLabel: translate("preview.mermaid.showDetails")
        }
      );
    }

    // Proxy measurement (#154): React's own commit timing isn't directly
    // observable, so this layout effect firing — which runs synchronously
    // right after React commits this subtree's DOM, before the browser
    // paints — stands in for "commit observed". durationMs is cumulative
    // from previewRenderStartedAt (this render's start), so it covers
    // React's reconciliation/commit/effect-scheduling gap plus the innerHTML
    // write above. It does NOT guarantee the browser has finished layout or
    // painted. documentOpenId/previewRenderStartedAt are read from this
    // render's closure rather than listed as effect deps, so an ordinary
    // content edit (which changes previewHtml but not the open) can't
    // resurrect a since-cleared documentOpenId and misreport itself as part
    // of the open.
    if (
      documentOpenId &&
      reportedPreviewDomCommitDocumentOpenIdRef.current !== documentOpenId
    ) {
      reportedPreviewDomCommitDocumentOpenIdRef.current = documentOpenId;
      onPreviewDomCommitted(
        documentOpenId,
        durationSincePerformanceMark(previewRenderStartedAt),
        previewElement.childElementCount
      );
    }

    const decorationStartedAt = performance.now();
    const decorationStats = decoratePreviewContainer(
      previewElement,
      surfaceIndex,
      glossaryEntries
    );

    if (
      documentOpenId &&
      reportedPreviewDecorationDocumentOpenIdRef.current !== documentOpenId
    ) {
      reportedPreviewDecorationDocumentOpenIdRef.current = documentOpenId;
      onPreviewDecorationCompleted(
        documentOpenId,
        durationSincePerformanceMark(decorationStartedAt),
        decorationStats.visitedTextNodeCount,
        decorationStats.decoratedNodeCount,
        decorationStats.matchCount
      );
    }

    // Proxy measurement (#154 follow-up): requestAnimationFrame callbacks
    // run just before the browser is about to paint the next frame, so this
    // stands in for "reached the next paint-adjacent frame boundary after
    // decoration" — it does NOT confirm a paint actually happened.
    // durationMs is this segment's own elapsed time (decoration-end to
    // callback firing), not cumulative from document-open start.
    //
    // documentOpenId is captured into frameDocumentOpenId (a const, not the
    // prop) so the async callback reports the id this specific frame
    // request belongs to, independent of whatever documentOpenId happens to
    // be current when the frame actually fires. Gating
    // (reportedPreviewFrameDocumentOpenIdRef) happens inside the callback,
    // not before requestAnimationFrame is called: gating it before would
    // make React StrictMode's mount/cleanup/mount double-invocation
    // (cleanup below cancels the first request) suppress this event
    // entirely, since the second invocation would see the ref already set
    // and never schedule a replacement frame.
    let frameRequestId: number | null = null;

    if (documentOpenId) {
      const frameDocumentOpenId = documentOpenId;
      const frameObservationStartedAt = performance.now();

      frameRequestId = requestAnimationFrame(() => {
        if (
          reportedPreviewFrameDocumentOpenIdRef.current !== frameDocumentOpenId
        ) {
          reportedPreviewFrameDocumentOpenIdRef.current = frameDocumentOpenId;
          onPreviewFrameObserved(
            frameDocumentOpenId,
            durationSincePerformanceMark(frameObservationStartedAt)
          );
        }
      });
    }

    // Cancels a still-pending frame request when this effect re-runs for a
    // newer open (or a genuine unmount) before the browser gets to it —
    // this is what prevents a superseded open's previewFrame.observed from
    // ever firing, rather than a documentOpenId comparison at report time.
    return () => {
      if (frameRequestId !== null) {
        cancelAnimationFrame(frameRequestId);
      }
    };
    // documentOpenId/previewRenderStartedAt/onPreviewDomCommitted/
    // onPreviewDecorationCompleted/onPreviewFrameObserved are deliberately
    // excluded: this effect must only re-run when the preview content
    // itself changes (open or edit), never merely because App.tsx cleared
    // documentOpenId after handleDocumentOpenMeasured — see comment above.
    // previewRenderer/translate (#564) are excluded for the same reason —
    // `previewHtml` is already recomputed whenever `previewRenderer`
    // changes (it is a dependency of the memo that produces it), so
    // whenever that change is actually consequential for Mermaid (a
    // Mermaid placeholder appearing/disappearing) `previewHtml` itself
    // changes and re-triggers this effect.
  }, [previewHtml, surfaceIndex]);

  // #731: hover card via event delegation on the preview container, so it
  // works for spans created by the decoration pass without per-span listeners.
  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    const decorationAt = (target: EventTarget | null): HTMLElement | null => {
      const element = target instanceof Element ? target.closest(decorationSelector) : null;
      return element instanceof HTMLElement && container.contains(element)
        ? element
        : null;
    };
    const handleMouseOver = (event: MouseEvent) => {
      const decoration = decorationAt(event.target);
      const entryIds = decoration?.dataset.glossaryEntryIds?.split(" ").filter(Boolean);
      if (!decoration || !entryIds || entryIds.length === 0) {
        return;
      }
      setHoverState({ entryIds, anchorRect: decoration.getBoundingClientRect() });
    };
    const handleMouseOut = (event: MouseEvent) => {
      const decoration = decorationAt(event.target);
      if (!decoration) {
        return;
      }
      // Moving within the same term (or onto a child of it) is not a leave.
      if (event.relatedTarget instanceof Node && decoration.contains(event.relatedTarget)) {
        return;
      }
      setHoverState(null);
    };

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, []);

  // Untagged decorations read the fallback pair from CSS variables on the
  // container, so changing `documentMap.glossaryFallbackColor` repaints them
  // without re-decorating.
  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }
    const colors = glossaryFallbackDecorationColors(glossaryFallbackColor);
    container.style.setProperty(
      "--glossary-decoration-fallback-rgb",
      glossaryDecorationRgbChannels(colors.backgroundRgb)
    );
    container.style.setProperty(
      "--glossary-decoration-fallback-foreground",
      colors.foregroundRgb
    );
  }, [glossaryFallbackColor]);

  useEffect(() => {
    previewRef.current?.style.setProperty(
      GLOSSARY_HIGHLIGHT_OPACITY_VAR,
      glossaryHighlightOpacityValue(glossaryHighlightOpacity)
    );
  }, [glossaryHighlightOpacity]);

  // The decorated spans are rebuilt on every preview commit; a card anchored to
  // a removed span must not linger.
  useEffect(() => {
    setHoverState(null);
  }, [previewHtml, surfaceIndex]);

  // The card is fixed-position, so any scroll would leave it detached from its term.
  const isHoverCardOpen = hoverState !== null;
  useEffect(() => {
    if (!isHoverCardOpen) {
      return;
    }
    const hide = () => setHoverState(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [isHoverCardOpen]);

  const hoverCardContents = useMemo(
    () =>
      hoverState
        ? buildGlossaryHoverCardContents(hoverState.entryIds, glossaryEntries)
        : [],
    [hoverState, glossaryEntries]
  );

  const isNarou = isNarouPreviewRenderer(previewRenderer);
  const className =
    previewRenderer === "aozoraHorizontal"
      ? "preview preview--aozora-horizontal"
      : previewRenderer === "aozoraVertical"
      ? "preview preview--aozora-vertical"
      : previewRenderer === "kakuyomuHorizontal"
      ? "preview preview--kakuyomu-horizontal"
      : previewRenderer === "kakuyomuVertical"
      ? "preview preview--kakuyomu-vertical"
      : previewRenderer === "narouHorizontal"
      ? "preview preview--narou-horizontal"
      : previewRenderer === "narouVertical"
      ? "preview preview--narou-vertical"
      : "preview";

  const markSymbol = narouMarkText && narouMarkText.trim() ? narouMarkText.trim() : "・";
  const style = isNarou
    ? ({ "--narou-emphasis-mark-symbol": JSON.stringify(markSymbol) } as React.CSSProperties)
    : undefined;

  return (
    <>
      <article className={className} style={style} ref={previewRef} />
      {hoverState && hoverCardContents.length > 0 ? (
        <div
          className="glossaryHoverCardLayer"
          style={hoverCardLayerStyle(hoverState.anchorRect)}
        >
          <GlossaryHoverCard contents={hoverCardContents} translate={translate} />
        </div>
      ) : null}
    </>
  );
}
