// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "@codemirror/commands";
import { CaretSettingsSection } from "../../src/renderer/components/CaretSettingsSection";
import { SettingsPanelView } from "../../src/renderer/SettingsPanel";
import { applyTextCursorSettingsToDom } from "../../src/renderer/caretSettingsCodeMirror";
import {
  defaultApplicationSettings,
  type ApplicationSettings,
} from "../../src/shared/settings";
import { enTranslations } from "../../src/shared/i18n/en";
import { jaTranslations } from "../../src/shared/i18n/ja";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const translate = (key: keyof typeof jaTranslations) => jaTranslations[key];
function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
describe("#725 custom caret UI and live surface", () => {
  let container: HTMLDivElement, root: Root;
  const onChange = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onChange.mockReset();
    document.documentElement.style.setProperty(
      "--pg-color-editor-caret",
      "#2563a8",
    );
    document.documentElement.style.setProperty(
      "--pg-color-editor-background",
      "#ffffff",
    );
    document.documentElement.style.setProperty(
      "--pg-color-editor-foreground",
      "#1f2933",
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    for (const property of [
      "--pg-color-editor-caret",
      "--pg-color-editor-background",
      "--pg-color-editor-foreground",
      "--pergamum-effective-caret",
      "--pergamum-block-foreground",
    ])
      document.documentElement.style.removeProperty(property);
  });
  function render(settings: ApplicationSettings, search = "", language: "ja" | "en" = "ja") {
    act(() =>
      root.render(
        <SettingsPanelView
          settings={settings}
          isLoading={false}
          error={null}
          translate={key => (language === "ja" ? jaTranslations : enTranslations)[key]}
          onChangeSettings={onChange}
          selectedCategoryId="textCursor"
          onSelectCategory={() => undefined}
          searchQuery={search}
          onSearchQueryChange={() => undefined}
        />,
      ),
    );
  }
  it.each(["ja", "en"] as const)("orders all seven caret settings as label, control, description, command path in category/search (%s)", language => {
    const translations = language === "ja" ? jaTranslations : enTranslations;
    const fields = ["style", "width", "blink", "colorMode", "autoCursorTextColor", "color", "cursorTextColor"] as const;
    for (const search of ["", "textCursor"]) {
      for (const settings of [defaultApplicationSettings, {
        ...defaultApplicationSettings,
        textCursor: { ...defaultApplicationSettings.textCursor, style: "block" as const,
          colorMode: "custom" as const, autoCursorTextColor: false },
      }]) {
        render(settings, search, language);
        for (const field of fields) {
          const row = [...container.querySelectorAll(".caretSettingRow, .settingsItemRow")]
            .find(row => row.querySelector(".settingsItemKey")?.textContent === `textCursor.${field}`)!;
          expect(row).toBeDefined();
          expect(row.querySelector(".caretSettingDescription, .settingsDescription")?.textContent)
            .toBe(translations[`settings.textCursor.${field}.description`]);
          if (field !== "style") expect(row.textContent).not.toContain("Block");
          const input = row.querySelector("input, select")!;
          expect(input.getAttribute("aria-label") ?? "").not.toContain("Block");
          const description = row.querySelector(".caretSettingDescription, .settingsDescription")!;
          const commandPath = row.querySelector(".settingsItemKey")!;
          const label = row.querySelector(".caretSettingLabel, .settingsItemLabel")!;
          expect(row.firstElementChild === label || row.firstElementChild?.contains(label)).toBe(true);
          expect(label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
          expect(input.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
          expect(description.nextElementSibling).toBe(commandPath);
          expect(row.lastElementChild).toBe(commandPath);
        }
      }
    }
    expect(translations["settings.textCursor.autoCursorTextColor.label"])
      .toBe(language === "ja" ? "カーソル内文字色を自動調整" : "Automatically adjust cursor text color");
    expect(translations["settings.textCursor.cursorTextColor.label"])
      .toBe(language === "ja" ? "カーソル内文字色" : "Cursor text color");
    expect(translations["settings.textCursor.style.block"]).toBe("Block");
  });
  it.each([false, true])(
    "enforces enablement and exposes every command path (search=%s)",
    (search) => {
      const initial = defaultApplicationSettings;
      render(initial, search ? "textCursor" : "");
      const color = () =>
        container.querySelector<HTMLInputElement>(
          search ? "[id='settingControl-textCursor.color']" : "#caret-color",
        )!;
      const manual = () =>
        container.querySelector<HTMLInputElement>(
          search
            ? "[id='settingControl-textCursor.cursorTextColor']"
            : "#caret-cursorTextColor",
        )!;
      const auto = () =>
        container.querySelector<HTMLInputElement>(
          search
            ? "[id='settingControl-textCursor.autoCursorTextColor']"
            : "#caretAutoCursorTextColor",
        )!;
      expect(color().disabled).toBe(true);
      expect(auto().disabled).toBe(true);
      expect(manual().disabled).toBe(true);
      for (const field of [
        "colorMode",
        "color",
        "autoCursorTextColor",
        "cursorTextColor",
      ])
        expect(container.textContent).toContain(`textCursor.${field}`);
      const settings = {
        ...initial,
        textCursor: {
          ...initial.textCursor,
          colorMode: "custom" as const,
          style: "block" as const,
        },
      };
      render(settings, search ? "textCursor" : "");
      expect(color().disabled).toBe(false);
      expect(auto().disabled).toBe(false);
      expect(manual().disabled).toBe(true);
      render(
        {
          ...settings,
          textCursor: { ...settings.textCursor, autoCursorTextColor: false },
        },
        search ? "textCursor" : "",
      );
      expect(manual().disabled).toBe(false);
      act(() => change(manual(), "#AbC"));
      expect(onChange.mock.calls.at(-1)?.[0].textCursor.cursorTextColor).toBe(
        "#aabbcc",
      );
      onChange.mockClear();
      act(() => change(color(), "invalid"));
      expect(onChange).not.toHaveBeenCalled();
      expect(color().value).toBe("invalid");
      expect(color().getAttribute("aria-invalid")).toBe("true");
    },
  );
  it.each([false, true])(
    "warns but permits manual low-contrast save (search=%s)",
    async (search) => {
      const settings = {
        ...defaultApplicationSettings,
        textCursor: {
          ...defaultApplicationSettings.textCursor,
          style: "block" as const,
          colorMode: "custom" as const,
          color: "#ffffff",
          cursorTextColor: "#ffffff",
          autoCursorTextColor: false,
        },
      };
      render(settings, search ? "textCursor.cursorTextColor" : "");
      expect(container.querySelector("[role='status']")?.textContent).toContain(
        "⚠ 読みにくい組み合わせです",
      );
      const input = container.querySelector<HTMLInputElement>(
        search
          ? "[id='settingControl-textCursor.cursorTextColor']"
          : "#caret-cursorTextColor",
      )!;
      act(() => change(input, "#fffffe"));
      expect(onChange.mock.calls.at(-1)?.[0].textCursor.cursorTextColor).toBe(
        "#fffffe",
      );
      render(
        {
          ...settings,
          textCursor: { ...settings.textCursor, autoCursorTextColor: true },
        },
        search ? "textCursor.cursorTextColor" : "",
      );
      expect(container.querySelector("[role='status']")).toBeNull();

      // CaretContrastWarning re-checks from a MutationObserver callback (a
      // microtask); let any pending one run inside act().
      await act(async () => {});
    },
  );
  it("updates theme/custom and cursor text color without recreating preview or changing history, selection, scroll", () => {
    let settings = { ...defaultApplicationSettings };
    function preview() {
      act(() =>
        root.render(
          <CaretSettingsSection
            settings={settings}
            isLoading={false}
            translate={translate}
            onChangeSettings={onChange}
          />,
        ),
      );
    }
    preview();
    const dom = container.querySelector<HTMLElement>(".cm-editor")!;
    const view = EditorView.findFromDOM(dom)!;
    view.dispatch({
      changes: { from: 0, insert: "edited " },
      selection: { anchor: 3 },
    });
    const doc = view.state.doc,
      selection = view.state.selection,
      depth = undoDepth(view.state);
    view.scrollDOM.scrollTop = 20;
    settings = {
      ...settings,
      textCursor: {
        ...settings.textCursor,
        colorMode: "custom",
        color: "#abcdef",
        style: "block",
        autoCursorTextColor: false,
        cursorTextColor: "#123456",
      },
    };
    preview();
    expect(container.querySelector(".cm-editor")).toBe(dom);
    expect(
      document.documentElement.style.getPropertyValue(
        "--pergamum-effective-caret",
      ),
    ).toBe("#abcdef");
    expect(
      document.documentElement.style.getPropertyValue(
        "--pergamum-block-foreground",
      ),
    ).toBe("#123456");
    settings = {
      ...settings,
      textCursor: { ...settings.textCursor, autoCursorTextColor: true },
    };
    preview();
    expect(
      document.documentElement.style.getPropertyValue(
        "--pergamum-block-foreground",
      ),
    ).not.toBe("#123456");
    document.documentElement.style.setProperty(
      "--pg-color-editor-caret",
      "#00d4ff",
    );
    document.documentElement.style.setProperty(
      "--pg-color-editor-background",
      "#101010",
    );
    settings = {
      ...settings,
      workbench: { ...settings.workbench, colorTheme: "ginza-night" },
    };
    preview();
    expect(
      document.documentElement.style.getPropertyValue(
        "--pergamum-effective-caret",
      ),
    ).toBe("#abcdef");
    settings = {
      ...settings,
      textCursor: { ...settings.textCursor, colorMode: "theme", style: "line" },
    };
    preview();
    expect(
      document.documentElement.style.getPropertyValue(
        "--pergamum-effective-caret",
      ),
    ).toBe("var(--pg-color-editor-caret)");
    expect(settings.textCursor.color).toBe("#abcdef");
    expect(settings.textCursor.cursorTextColor).toBe("#123456");
    expect(view.state.doc).toBe(doc);
    expect(view.state.selection).toBe(selection);
    expect(undoDepth(view.state)).toBe(depth);
    expect(view.scrollDOM.scrollTop).toBe(20);
    expect(undo(view)).toBe(true);
  });
  it("refreshes Line warnings when theme tokens are applied after Settings effects", async () => {
    const settings = { ...defaultApplicationSettings, textCursor: { ...defaultApplicationSettings.textCursor, colorMode: "custom" as const, color: "#ffffff" } };
    render(settings);
    expect(container.querySelector("[role='status']")).not.toBeNull();
    await act(async () => {
      document.documentElement.style.setProperty("--pg-color-editor-background", "#000000");
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.querySelector("[role='status']")).toBeNull();
  });
  it.each(["colorMode", "color", "autoCursorTextColor", "cursorTextColor"] as const)("finds and edits the individual command path %s", field => {
    const settings = { ...defaultApplicationSettings, textCursor: { ...defaultApplicationSettings.textCursor, style: "block" as const,
      colorMode: "custom" as const, color: "#abcdef", cursorTextColor: "#123456", autoCursorTextColor: false } };
    render(settings, `textCursor.${field}`);
    const control = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[id='settingControl-textCursor.${field}']`)!;
    expect(control).not.toBeNull(); expect(control.disabled).toBe(false);
    act(() => { if (field === "autoCursorTextColor") control.click(); else change(control, field === "colorMode" ? "theme" : "#00d4ff"); });
    const next = onChange.mock.calls.at(-1)?.[0].textCursor;
    expect(next[field]).toBe(field === "autoCursorTextColor" ? true : field === "colorMode" ? "theme" : "#00d4ff");
    if (field !== "color") expect(next.color).toBe(settings.textCursor.color);
    if (field !== "cursorTextColor") expect(next.cursorTextColor).toBe(settings.textCursor.cursorTextColor);
  });
  it("never mutates caret theme or drop cursor tokens", () => {
    document.documentElement.style.setProperty(
      "--pg-color-editor-drop-cursor",
      "#987654",
    );
    applyTextCursorSettingsToDom({
      ...defaultApplicationSettings.textCursor,
      colorMode: "custom",
      color: "#abcdef",
    });
    expect(
      document.documentElement.style.getPropertyValue(
        "--pg-color-editor-caret",
      ),
    ).toBe("#2563a8");
    expect(
      document.documentElement.style.getPropertyValue(
        "--pg-color-editor-drop-cursor",
      ),
    ).toBe("#987654");
    document.documentElement.style.removeProperty(
      "--pg-color-editor-drop-cursor",
    );
  });
});
