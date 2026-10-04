import { isLightByYiq } from "../../src/shared/colorYiq";
import { describe, expect, it } from "vitest";
import {
  autoBlockForeground,
  effectiveCaretColors,
} from "../../src/shared/caretColors";
import { contrastRatio } from "../../src/shared/colorContrast";
import {
  defaultApplicationSettings,
  defaultTextCursorSettings,
  resolveEffectiveSettings,
} from "../../src/shared/settings";
import {
  resolveCatalogValue,
  validateCatalogValue,
} from "../../src/shared/settingsCatalog";
import { settingCatalogItems } from "../../src/shared/settingsUiCatalog";
import { exportableApplicationSettings } from "../../src/shared/settingsExport";
const theme = {
  caret: "#2563a8",
  background: "#ffffff",
  foreground: "#1f2933",
};

describe("#725 colors and settings contract", () => {
  it("defaults to theme and auto, exports retained values, and resolves missing fields", () => {
    expect(defaultTextCursorSettings).toMatchObject({
      colorMode: "theme",
      autoCursorTextColor: true,
      color: theme.caret,
      cursorTextColor: theme.background,
    });
    const cursor = {
      ...defaultTextCursorSettings,
      color: "#abcdef",
      cursorTextColor: "#123456",
    };
    expect(
      exportableApplicationSettings({
        ...defaultApplicationSettings,
        textCursor: cursor,
      }).textCursor,
    ).toEqual(cursor);
    expect(
      resolveEffectiveSettings(
        {
          ...defaultApplicationSettings,
          textCursor: { style: "line", width: 1, blink: 1200 } as typeof cursor,
        },
        null,
      ).textCursor,
    ).toEqual(defaultTextCursorSettings);
    for (const field of [
      "colorMode",
      "color",
      "autoCursorTextColor",
      "cursorTextColor",
    ] as const) {
      expect(
        settingCatalogItems.find((item) => item.key === `textCursor.${field}`)
          ?.category,
      ).toBe("textCursor");
      expect(
        resolveCatalogValue(`textCursor.${field}`, undefined).value,
      ).toEqual(defaultTextCursorSettings[field]);
    }
  });
  it("matches existing HEX whitespace normalization", () => {
    expect(resolveCatalogValue("textCursor.color", "  #AbCdEf  ").value).toBe("#abcdef");
  });
  it.each(["theme", "custom"])("accepts mode %s", (value) =>
    expect(validateCatalogValue("textCursor.colorMode", value).ok).toBe(true),
  );
  it.each(["Theme", "invalid", null, true])(
    "rejects invalid mode %s",
    (value) =>
      expect(validateCatalogValue("textCursor.colorMode", value).ok).toBe(
        false,
      ),
  );
  it.each(["color", "cursorTextColor"] as const)(
    "normalizes valid HEX and rejects invalid %s",
    (field) => {
      expect(resolveCatalogValue(`textCursor.${field}`, "#AbC").value).toBe(
        "#aabbcc",
      );
      for (const value of ["red", "#12345", "#12345678", "#gggggg", "", null])
        expect(validateCatalogValue(`textCursor.${field}`, value).ok).toBe(
          false,
        );
    },
  );
  it("uses YIQ direction, theme candidates first, and deterministic WCAG-qualified fallback", () => {
    expect(isLightByYiq({ r: 127, g: 127, b: 127 })).toBe(false);
    expect(isLightByYiq({ r: 128, g: 128, b: 128 })).toBe(true);
    expect(autoBlockForeground("#ffffff", theme)).toBe(theme.foreground);
    expect(autoBlockForeground("#000000", theme)).toBe(theme.background);
    expect(
      autoBlockForeground("#7f7f7f", {
        ...theme,
        background: "#000000",
        foreground: "#ffffff",
      }),
    ).toBe("#000000");
    expect(
      autoBlockForeground("#808080", {
        ...theme,
        background: "#000000",
        foreground: "#ffffff",
      }),
    ).toBe("#000000");
    for (const caret of [
      "#000000",
      "#ffffff",
      "#7f7f7f",
      "#808080",
      "#00d4ff",
      "#ff00ff",
    ]) {
      const equalTheme = { ...theme, background: caret, foreground: caret };
      const result = autoBlockForeground(caret, equalTheme);
      expect(contrastRatio(result, caret)).toBeGreaterThanOrEqual(4.5);
      expect(autoBlockForeground(caret, equalTheme)).toBe(result);
    }
  });
  it("preserves custom/manual choices across mode, style, theme, and auto toggles", () => {
    const cursor = {
      ...defaultTextCursorSettings,
      color: "#abcdef",
      cursorTextColor: "#abcdef",
      autoCursorTextColor: false,
    };
    expect(effectiveCaretColors(cursor, theme).caret).toBe(theme.caret);
    const custom = { ...cursor, colorMode: "custom" as const };
    for (const style of ["line", "block"] as const) {
      expect(effectiveCaretColors({ ...custom, style }, theme)).toMatchObject({
        caret: custom.color,
        foreground: custom.cursorTextColor,
      });
      expect(
        effectiveCaretColors(
          { ...custom, style },
          { ...theme, caret: "#000000" },
        ).caret,
      ).toBe(custom.color);
    }
    expect(
      effectiveCaretColors({ ...custom, autoCursorTextColor: true }, theme)
        .foreground,
    ).not.toBe(custom.cursorTextColor);
    expect(effectiveCaretColors(custom, theme).foreground).toBe(
      custom.cursorTextColor,
    );
    expect(cursor.color).toBe("#abcdef");
    expect(cursor.cursorTextColor).toBe("#abcdef");
  });
  it("warns strictly below the appropriate threshold without changing values", () => {
    const custom = {
      ...defaultTextCursorSettings,
      colorMode: "custom" as const,
      autoCursorTextColor: false,
    };
    expect(
      effectiveCaretColors({ ...custom, color: "#959595" }, theme).warning,
    ).toBe(true);
    expect(
      effectiveCaretColors({ ...custom, color: "#949494" }, theme).warning,
    ).toBe(false);
    expect(
      effectiveCaretColors(
        {
          ...custom,
          style: "block",
          color: "#ffffff",
          cursorTextColor: "#777777",
        },
        theme,
      ).warning,
    ).toBe(true);
    expect(
      effectiveCaretColors(
        {
          ...custom,
          style: "block",
          color: "#ffffff",
          cursorTextColor: "#767676",
        },
        theme,
      ).warning,
    ).toBe(false);
    expect(
      effectiveCaretColors(
        { ...custom, color: "#ffffff", colorMode: "theme" },
        theme,
      ).warning,
    ).toBe(false);
  });
});
