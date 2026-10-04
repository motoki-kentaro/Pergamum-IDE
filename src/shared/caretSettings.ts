/** #719: one contract for UI, persistence and editor caret settings.
 * The document editor uses a 15px font (.editorHost .cm-editor);
 * 15px is approximately one full-width glyph. Keep the bound fixed so
 * main-process validation does not depend on a renderer measurement.
 */
export const CARET_WIDTH = { min: 1, max: 15, step: 1, default: 1 } as const;
export const CARET_BLINK = { min: 0, max: 2000, step: 200, default: 1200 } as const;

export const caretStyles = ["line", "block"] as const;
export type CaretStyle = (typeof caretStyles)[number];
