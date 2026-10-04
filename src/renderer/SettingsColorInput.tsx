import { useEffect, useState } from "react";
import { normalizeDocumentMapColor } from "../shared/documentMapSettings";
import type { Translate } from "../shared/i18n";

/** Shared native picker + HEX draft contract from Document Map settings. */
export function SettingsColorInput({
  value,
  disabled,
  label,
  id,
  translate,
  onChange,
  normalizeOnChange = true,
}: {
  value: string;
  disabled: boolean;
  label: string;
  id?: string;
  translate: Translate;
  onChange: (color: string) => void;
  normalizeOnChange?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const normalized = normalizeDocumentMapColor(draft);
  function change(raw: string) {
    setDraft(raw);
    const color = normalizeDocumentMapColor(raw);
    if (!normalizeOnChange) onChange(raw);
    else if (color !== null) onChange(color);
  }
  return (
    <>
      <span className="documentMapSettingsColorInputs">
        <input
          type="color"
          className="documentMapSettingsColorSwatch"
          value={normalized ?? normalizeDocumentMapColor(value) ?? "#888888"}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => change(event.target.value)}
        />
        <input
          id={id}
          type="text"
          className="documentMapSettingsColorText"
          value={draft}
          disabled={disabled}
          aria-label={label}
          aria-invalid={normalized === null || undefined}
          onChange={(event) => change(event.target.value)}
        />
      </span>
      {normalized === null && (
        <span className="documentMapSettingsError" role="alert">
          {translate("settings.documentMap.color.invalid")}
        </span>
      )}
    </>
  );
}
