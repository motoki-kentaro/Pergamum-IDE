/** #719: application caret controls and a live CodeMirror preview. */
import { useEffect, useRef, useState, type FC } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Language, Translate } from "../../shared/i18n";
import { resolveColorTheme } from "../../shared/colorTheme";
import { CARET_WIDTH, CARET_BLINK } from "../../shared/caretSettings";
import { validateCatalogValue } from "../../shared/settingsCatalog";
import {
  toSaveApplicationSettingsRequest,
  type ApplicationSettings,
  type SaveApplicationSettingsRequest
} from "../../shared/settings";
import { caretStyleCompartment, createCaretStyleExtension } from "../blockCaretExtension";
import { createEditorThemeExtension, editorThemeModeCompartment } from "../editorThemeExtension";
import {
  applyTextCursorSettingsToDom, caretBlinkCompartment,
  createCaretBlinkExtension, createPreviewUnfocusedCaretExtension
} from "../caretSettingsCodeMirror";

export interface CaretSettingsSectionProps {
  settings: ApplicationSettings;
  isLoading: boolean;
  displayLanguage?: Language;
  translate: Translate;
  onChangeSettings: (settings: SaveApplicationSettingsRequest) => void;
}

/** Like Document Map opacity: retain invalid drafts, save only valid values.
 * Shared with Settings search results so neither route bypasses validation.
 */
interface CaretNumberControlProps {
  field: "width" | "blink";
  value: number;
  disabled: boolean;
  translate: Translate;
  onChange: (value: number) => void;
  showSlider?: boolean;
  numberId?: string;
}

export function CaretNumberControl({
  field,
  value,
  disabled,
  translate,
  onChange,
  showSlider = true,
  numberId
}: CaretNumberControlProps): JSX.Element {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const range = field === "width" ? CARET_WIDTH : CARET_BLINK;
  const key = `textCursor.${field}` as const;
  const invalid = text.trim() === "" || !validateCatalogValue(key, Number(text)).ok;
  const prefix = field === "width" ? "caretWidth" : "caretBlink";
  const errorId = `${prefix}Error`;
  function change(raw: string): void {
    setText(raw);
    if (raw.trim() !== "" && validateCatalogValue(key, Number(raw)).ok) {
      onChange(Number(raw));
    }
  }
  return (
    <>
    <div className="caretSettingInputGroup">
      {showSlider && <input id={`${prefix}Range`} className="caretSettingSlider"
        type="range" min={range.min} max={range.max} step={range.step}
        value={invalid ? value : Number(text)} disabled={disabled}
        aria-label={translate(`settings.textCursor.${field}.label`)}
        onChange={(event) => change(event.target.value)} data-testid={`${prefix}Slider`} />}
      <input id={numberId ?? `${prefix}Number`} className="settingsNumberInput caretSettingNumberInput"
        type="number" min={range.min} max={range.max} step={range.step}
        value={text} disabled={disabled} aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        aria-label={translate(`settings.textCursor.${field}.label`)}
        onChange={(event) => change(event.target.value)} data-testid={`${prefix}NumberInput`} />
      <span className="caretSettingUnit">{translate(field === "width" ? "settings.unit.px" : "settings.unit.ms")}</span>
    </div>
    {invalid && <p id={errorId} className="settingsError" role="alert">
      {translate(`settings.textCursor.${field}.invalid`)}
    </p>}
    </>
  );
}

export const CaretSettingsSection: FC<CaretSettingsSectionProps> = ({
  settings,
  isLoading,
  displayLanguage,
  translate,
  onChangeSettings
}) => {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewCaretCompartment = useRef(new Compartment()).current;
  const textCursor = settings.textCursor;
  const theme = resolveColorTheme(settings.workbench.colorTheme);
  const initialText = translate("settings.textCursor.sampleText");

  useEffect(() => {
    if (!editorContainerRef.current) {
      return;
    }
    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions: [
        history(), keymap.of([...defaultKeymap, ...historyKeymap]),
        createEditorThemeExtension(),
        editorThemeModeCompartment.of(EditorView.darkTheme.of(theme.kind === "dark")),
        caretBlinkCompartment.of(createCaretBlinkExtension(textCursor.blink)),
        caretStyleCompartment.of(createCaretStyleExtension(textCursor.style, true)),
        previewCaretCompartment.of(createPreviewUnfocusedCaretExtension(textCursor.blink))
      ] }),
      parent: editorContainerRef.current
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only changing the sample language remounts this preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayLanguage]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editorThemeModeCompartment.reconfigure(
      EditorView.darkTheme.of(theme.kind === "dark")
    ) });
  }, [theme.kind, displayLanguage]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: [
      caretBlinkCompartment.reconfigure(createCaretBlinkExtension(textCursor.blink)),
      previewCaretCompartment.reconfigure(createPreviewUnfocusedCaretExtension(textCursor.blink))
    ] });
  }, [textCursor.blink, previewCaretCompartment, displayLanguage]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: caretStyleCompartment.reconfigure(
      createCaretStyleExtension(textCursor.style, true)
    ) });
  }, [textCursor.style, displayLanguage]);

  function update(field: "width" | "blink", value: number): void {
    const next = { ...textCursor, [field]: value };
    applyTextCursorSettingsToDom(next);
    onChangeSettings({ ...toSaveApplicationSettingsRequest(settings), textCursor: next });
  }

  return <div className="caretSettingsSection" data-testid="caretSettingsSection">
    <div className="caretPreviewEditorWrapper" data-testid="caretPreviewEditorWrapper">
      <div ref={editorContainerRef} className="caretPreviewEditorHost" data-testid="caretPreviewEditorHost" />
    </div>
    <div className="caretSettingsControls">
      <div className="caretSettingRow">
        <label htmlFor="caretStyleSelect">{translate("settings.textCursor.style.label")}</label>
        <p className="caretSettingDescription">{translate("settings.textCursor.style.description")}</p>
        <select id="caretStyleSelect" className="settingsSelect" value={textCursor.style}
          disabled={isLoading} onChange={(event) => {
            const style = event.target.value;
            if (style === "line" || style === "block") {
              onChangeSettings({ ...toSaveApplicationSettingsRequest(settings), textCursor: { ...textCursor, style } });
            }
          }}>
          <option value="line">{translate("settings.textCursor.style.line")}</option>
          <option value="block">{translate("settings.textCursor.style.block")}</option>
        </select>
        <code className="settingsItemKey">textCursor.style</code>
      </div>
      {(["width", "blink"] as const).map((field) => <div key={field} className="caretSettingRow"
        data-testid={field === "width" ? "caretWidthRow" : "caretBlinkRow"}>
        <label className="caretSettingLabel" htmlFor={field === "width" ? "caretWidthRange" : "caretBlinkRange"}>
          {translate(`settings.textCursor.${field}.label`)}
        </label>
        <p className="caretSettingDescription">{translate(`settings.textCursor.${field}.description`)}</p>
        <CaretNumberControl field={field} value={textCursor[field]} disabled={isLoading || field === "width" && textCursor.style === "block"}
          translate={translate} onChange={(value) => update(field, value)} />
        <code className="settingsItemKey">{`textCursor.${field}`}</code>
      </div>)}
    </div>
  </div>;
};
