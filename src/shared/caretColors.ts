import { contrastRatio, parseColor } from "./colorContrast";
import { isLightByYiq } from "./colorYiq";
import type { ApplicationTextCursorSettings } from "./settings";

export interface CaretThemeColors {
  caret: string;
  background: string;
  foreground: string;
}
/** YIQ orders candidates; WCAG is the final verdict. Theme colors win within each direction. */
export function autoBlockForeground(
  caret: string,
  theme: CaretThemeColors,
): string {
  const lightCaret = isLightByYiq(parseColor(caret)!);
  const themeCandidates = [theme.background, theme.foreground];
  const preferred = themeCandidates.filter(
    (color) => isLightByYiq(parseColor(color)!) !== lightCaret,
  );
  const remaining = themeCandidates.filter(
    (color) => !preferred.includes(color),
  );
  return [
    ...preferred,
    ...remaining,
    ...(lightCaret ? ["#000000", "#ffffff"] : ["#ffffff", "#000000"]),
  ].find((color) => contrastRatio(color, caret) >= 4.5)!;
}
export function effectiveCaretColors(
  settings: ApplicationTextCursorSettings,
  theme: CaretThemeColors,
) {
  const caret = settings.colorMode === "custom" ? settings.color : theme.caret;
  const foreground = settings.autoCursorTextColor
    ? autoBlockForeground(caret, theme)
    : settings.cursorTextColor;
  const warning =
    settings.style === "block"
      ? contrastRatio(foreground, caret) < 4.5
      : settings.colorMode === "custom" &&
        contrastRatio(caret, theme.background) < 3;
  return { caret, foreground, warning };
}
