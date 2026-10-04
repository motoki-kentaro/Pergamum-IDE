/**
 * #719: Text cursor (caret) CodeMirror extensions and configuration helpers.
 *
 * Implements pure CodeMirror extension helpers for text cursor width and blink interval,
 * designed for live reconfiguration without recreating the EditorView.
 */

import { Compartment, type Extension } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { CARET_WIDTH, CARET_BLINK } from "../shared/caretSettings";
import type { ApplicationTextCursorSettings } from "../shared/settings";

export const DEFAULT_CARET_BLINK_RATE = CARET_BLINK.default;
export const MIN_CARET_BLINK_RATE = CARET_BLINK.min;
export const MAX_CARET_BLINK_RATE = CARET_BLINK.max;
export const STEP_CARET_BLINK_RATE = CARET_BLINK.step;

export const DEFAULT_CARET_WIDTH = CARET_WIDTH.default;
export const MIN_CARET_WIDTH = CARET_WIDTH.min;
export const MAX_CARET_WIDTH = CARET_WIDTH.max;

/**
 * Compartment for dynamic caret blink rate reconfiguration.
 */
export const caretBlinkCompartment = new Compartment();

/**
 * Applies text cursor CSS variables (--pergamum-text-cursor-width)
 * to document.documentElement for dynamic restyling of all active CodeMirror editors without re-dispatch.
 */
export function applyTextCursorSettingsToDom(
  textCursorSettings: ApplicationTextCursorSettings | undefined
): void {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  const root = document.documentElement;
  const width = textCursorSettings?.width ?? DEFAULT_CARET_WIDTH;
  root.style.setProperty("--pergamum-text-cursor-width", `${width}px`);
}

/**
 * Creates an extension configuring drawSelection with cursorBlinkRate.
 * Used by normal editors as well as the settings preview.
 */
export function createCaretBlinkExtension(blinkRateMs: number): Extension {
  return drawSelection({ cursorBlinkRate: blinkRateMs });
}

/**
 * Preview-only extension that ensures the caret remains visible and blinking
 * even when the mini editor loses focus to the settings sliders, buttons, or inputs.
 * MUST NOT be used in normal markdown editors.
 */
export function createPreviewUnfocusedCaretExtension(blinkRateMs: number): Extension {
  const isBlinkDisabled = blinkRateMs <= 0;

  return EditorView.theme({
    "& .cm-cursor": {
      display: "block !important"
    },
    "& > .cm-scroller > .cm-cursorLayer": isBlinkDisabled
      ? {
          animation: "none !important",
          opacity: "1 !important"
        }
      : {
          animationName: "cm-blink",
          animationTimingFunction: "steps(1)",
          animationIterationCount: "infinite",
          animationDuration: `${blinkRateMs}ms !important`
        }
  });
}
