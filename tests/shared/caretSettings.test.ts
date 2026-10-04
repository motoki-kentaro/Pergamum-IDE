import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CARET_BLINK, CARET_WIDTH } from "../../src/shared/caretSettings";
import { defaultApplicationSettings, resolveEffectiveSettings } from "../../src/shared/settings";
import { getCatalogEntry, validateCatalogValue, isSettingKey } from "../../src/shared/settingsCatalog";
import { settingCatalogItems } from "../../src/shared/settingsUiCatalog";

describe("#719 caret setting contract", () => {
  it("matches the current document and preview font geometry", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8");
    for (const selector of [".editorHost .cm-editor", ".caretPreviewEditorHost .cm-editor"]) {
      const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0] ?? "";
      expect(block).toContain(`font-size: ${CARET_WIDTH.max}px;`);
    }
  });
  it("uses the same bounds and defaults in persistence and search UI", () => {
    for (const [key, range] of [["textCursor.width", CARET_WIDTH], ["textCursor.blink", CARET_BLINK]] as const) {
      const entry = getCatalogEntry(key);
      expect(entry.scope).toBe("applicationOnly");
      expect(entry.defaultValue).toBe(range.default);
      expect(entry.numericRange).toMatchObject({ min: range.min, max: range.max });
      expect(settingCatalogItems.find((item) => item.key === key)?.control)
        .toEqual({ kind: "number", min: range.min, max: range.max, step: range.step });
    }
    expect(defaultApplicationSettings.textCursor).toEqual({ width: 1, blink: 1200 });
    expect(resolveEffectiveSettings(defaultApplicationSettings, null).textCursor).toEqual({ width: 1, blink: 1200 });
    expect(isSettingKey("textCursor.color")).toBe(false);
  });
  it.each(Array.from({ length: 11 }, (_, i) => i * 200))("accepts blink %s", (value) => {
    expect(validateCatalogValue("textCursor.blink", value).ok).toBe(true);
  });
  it.each([-1, 1, 199, 201, 500, 2200, 200.5, NaN, Infinity])("rejects blink %s", (value) => {
    expect(validateCatalogValue("textCursor.blink", value).ok).toBe(false);
  });
  it.each([0, 16, 100, 1.5, NaN, Infinity])("rejects width %s", (value) => {
    expect(validateCatalogValue("textCursor.width", value).ok).toBe(false);
  });
});
