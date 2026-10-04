import { useEffect, useState } from "react";
import type { ApplicationSettings } from "../shared/settings";
import type { Translate } from "../shared/i18n";
import { effectiveCaretColors } from "../shared/caretColors";
import { readCaretThemeColors } from "./caretSettingsCodeMirror";

export function CaretContrastWarning({
  settings,
  translate,
}: {
  settings: ApplicationSettings;
  translate: Translate;
}): JSX.Element | null {
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    const refresh = () =>
      setWarning(
        effectiveCaretColors(settings.textCursor, readCaretThemeColors())
          .warning,
      );
    refresh();
    // Child effects can run before App applies the new theme class. Observe
    // the applied root tokens as well so the advisory never uses the old theme.
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [settings.textCursor, settings.workbench.colorTheme]);
  return warning ? (
    <p className="settingsDescription" role="status">
      {translate("settings.textCursor.contrast.warning")}
    </p>
  ) : null;
}
