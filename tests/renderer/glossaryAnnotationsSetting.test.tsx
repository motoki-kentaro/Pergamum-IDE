// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  SettingsPanel,
  getVisibleSettingCatalogItems
} from "../../src/renderer/SettingsPanel";
import { defaultApplicationSettings } from "../../src/shared/settings";
import { getCatalogEntry } from "../../src/shared/settingsCatalog";
import { isProjectOverrideEligibleScope } from "../../src/renderer/ProjectSettingsPanel";
import { settingCatalogItems } from "../../src/shared/settingsUiCatalog";
import { t, type Language, type Translate } from "../../src/shared/i18n";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "preview.glossaryAnnotations";
const translateFor =
  (language: Language): Translate =>
  (key, values) =>
    t(language, key, values);

describe("preview.glossaryAnnotations setting (#731)", () => {
  it("is an applicationOnly boolean that defaults to OFF", () => {
    const entry = getCatalogEntry(KEY);
    expect(entry.type).toBe("boolean");
    expect(entry.scope).toBe("applicationOnly");
    expect(isProjectOverrideEligibleScope(entry.scope)).toBe(false);
    expect(defaultApplicationSettings.preview.glossaryAnnotations).toBe(false);
  });

  it("sits in Preview between the font list and the update delay", () => {
    const keys = getVisibleSettingCatalogItems(
      "",
      "preview",
      translateFor("ja")
    ).map((item) => item.key);

    expect(keys).toEqual([
      "preview.renderer",
      "preview.fontFamilyList",
      KEY,
      "preview.glossaryHighlightOpacity",
      "preview.updateDelayMs",
      "preview.syncScrollEditorToPreview",
      "preview.syncScrollPreviewToEditor",
      "preview.doubleClickJumpToEditor"
    ]);
  });

  it("is searchable by its label in both languages", () => {
    for (const [language, query] of [
      ["ja", "語彙ホバーカード"],
      ["en", "glossary hover"]
    ] as const) {
      expect(
        getVisibleSettingCatalogItems(query, "application", translateFor(language))
          .map((item) => item.key)
      ).toContain(KEY);
    }
  });

  it("has the requested JA / EN label and a description saying decoration + hover", () => {
    expect(t("ja", "settings.preview.glossaryAnnotations.label")).toBe(
      "語彙ホバーカードを有効にする"
    );
    expect(t("en", "settings.preview.glossaryAnnotations.label")).toBe(
      "Enable glossary hover cards"
    );
    expect(t("ja", "settings.preview.glossaryAnnotations.description")).toMatch(
      /装飾.*ホバー/
    );
    expect(t("en", "settings.preview.glossaryAnnotations.description")).toMatch(
      /Highlights.*hover/
    );
  });

  it("is not offered in Project Settings (applicationOnly)", () => {
    const projectEligible = settingCatalogItems.filter((item) =>
      isProjectOverrideEligibleScope(getCatalogEntry(item.key).scope)
    );
    expect(projectEligible.map((item) => item.key)).not.toContain(KEY);
  });

  it("the effective settings carry the Application value straight through", () => {
    const source = readFileSync("src/shared/settings.ts", "utf8");
    expect(source).toContain(
      "glossaryAnnotations: applicationSettings.preview.glossaryAnnotations"
    );
  });
});

describe("Settings UI toggle for preview.glossaryAnnotations (#731)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChangeSettings = vi.fn();

  beforeEach(() => {
    onChangeSettings.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders an unchecked switch in Preview and saves the change under preview", () => {
    act(() => {
      root.render(
        <SettingsPanel
          settings={defaultApplicationSettings}
          isLoading={false}
          error={null}
          translate={translateFor("ja")}
          onChangeSettings={onChangeSettings}
        />
      );
    });
    const categoryButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settingsCategoryButton")
    ).find(
      (button) =>
        button.textContent?.trim() ===
        translateFor("ja")("settings.category.preview.label")
    );
    act(() => categoryButton!.click());

    const input = container.querySelector<HTMLInputElement>(
      `#settingControl-${CSS.escape(KEY)}`
    );
    expect(input).not.toBeNull();
    expect(input!.checked).toBe(false);

    act(() => input!.click());

    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    expect(onChangeSettings.mock.calls[0][0].preview.glossaryAnnotations).toBe(
      true
    );
  });
});

describe("Glossary highlight opacity control (#731)", () => {
  const OPACITY_KEY = "preview.glossaryHighlightOpacity";
  let container: HTMLDivElement;
  let root: Root;
  const onChangeSettings = vi.fn();

  beforeEach(() => {
    onChangeSettings.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderPreview(
    preview: Partial<typeof defaultApplicationSettings.preview> = {}
  ): void {
    // Fresh mount each call so the control's local draft never leaks across renders.
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(
        <SettingsPanel
          settings={{
            ...defaultApplicationSettings,
            preview: { ...defaultApplicationSettings.preview, ...preview }
          }}
          isLoading={false}
          error={null}
          translate={translateFor("ja")}
          onChangeSettings={onChangeSettings}
        />
      );
    });
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settingsCategoryButton")
    ).find(
      (candidate) =>
        candidate.textContent?.trim() ===
        translateFor("ja")("settings.category.preview.label")
    );
    if (!button) throw new Error("preview category not found");
    act(() => button.click());
  }

  const numberInput = () =>
    container.querySelector<HTMLInputElement>(
      `#settingControl-${CSS.escape(OPACITY_KEY)}`
    )!;
  const slider = () =>
    container.querySelector<HTMLInputElement>(".settingsSlider")!;
  const lastSaved = () =>
    onChangeSettings.mock.calls.at(-1)![0].preview.glossaryHighlightOpacity;

  function spinTo(value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(numberInput(), value);
      // A spinner click is a plain `input` event (no `inputType`).
      numberInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function pressArrow(key: "ArrowUp" | "ArrowDown"): void {
    act(() => {
      numberInput().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );
    });
  }

  it("is a slider (0..1, step 0.05) plus a number input, right under the hover-card switch", () => {
    renderPreview({ glossaryAnnotations: true });

    expect(slider().type).toBe("range");
    expect(slider().min).toBe("0");
    expect(slider().max).toBe("1");
    expect(slider().step).toBe("0.05");
    expect(numberInput().type).toBe("number");
    expect(numberInput().value).toBe("0.35");

    const ids = Array.from(container.querySelectorAll("[id^='settingControl-']")).map(
      (element) => element.id
    );
    expect(ids.indexOf(`settingControl-${KEY}`)).toBeGreaterThan(-1);
    expect(ids.indexOf(`settingControl-${OPACITY_KEY}`)).toBe(
      ids.indexOf(`settingControl-${KEY}`) + 1
    );
  });

  it("the slider moves in 0.05 steps", () => {
    renderPreview({ glossaryAnnotations: true });
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(slider(), "0.4");
      slider().dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(lastSaved()).toBe(0.4);
  });

  it("the spinner moves in 0.1 steps: 0.35 → 0.45 up, 0.35 → 0.25 down", () => {
    renderPreview({ glossaryAnnotations: true });
    spinTo("0.4"); // native spinner up (+0.05) is re-mapped to +0.1
    expect(lastSaved()).toBe(0.45);

    onChangeSettings.mockClear();
    renderPreview({ glossaryAnnotations: true });
    spinTo("0.3"); // native spinner down (-0.05) is re-mapped to -0.1
    expect(lastSaved()).toBe(0.25);
  });

  it("ArrowUp / ArrowDown also move by 0.1 and clamp to 0..1", () => {
    renderPreview({ glossaryAnnotations: true });
    pressArrow("ArrowUp");
    expect(lastSaved()).toBe(0.45);

    onChangeSettings.mockClear();
    renderPreview({ glossaryAnnotations: true, glossaryHighlightOpacity: 0.95 });
    pressArrow("ArrowUp");
    expect(lastSaved()).toBe(1);

    onChangeSettings.mockClear();
    renderPreview({ glossaryAnnotations: true, glossaryHighlightOpacity: 0.05 });
    pressArrow("ArrowDown");
    expect(lastSaved()).toBe(0);
  });

  it("typing a valid 0.05 multiple is accepted as typed; an off-grid value is not saved", () => {
    renderPreview({ glossaryAnnotations: true });
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(numberInput(), "0.7");
      numberInput().dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText" })
      );
    });
    expect(lastSaved()).toBe(0.7);

    onChangeSettings.mockClear();
    act(() => {
      setter?.call(numberInput(), "0.33");
      numberInput().dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText" })
      );
    });
    expect(onChangeSettings).not.toHaveBeenCalled();
    expect(numberInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("is disabled while the hover-card switch is OFF, and keeps its stored value", () => {
    renderPreview({ glossaryAnnotations: false, glossaryHighlightOpacity: 0.6 });

    expect(slider().disabled).toBe(true);
    expect(numberInput().disabled).toBe(true);
    expect(numberInput().value).toBe("0.6");
    pressArrow("ArrowUp");
    expect(onChangeSettings).not.toHaveBeenCalled();

    // Turning the switch back ON re-enables the control with the same value.
    renderPreview({ glossaryAnnotations: true, glossaryHighlightOpacity: 0.6 });
    expect(slider().disabled).toBe(false);
    expect(numberInput().disabled).toBe(false);
    expect(numberInput().value).toBe("0.6");
  });

  it("toggling the switch never writes the opacity", () => {
    renderPreview({ glossaryAnnotations: false, glossaryHighlightOpacity: 0.6 });
    const toggle = container.querySelector<HTMLInputElement>(
      `#settingControl-${CSS.escape(KEY)}`
    )!;
    act(() => toggle.click());

    const saved = onChangeSettings.mock.calls.at(-1)![0].preview;
    expect(saved.glossaryAnnotations).toBe(true);
    expect(saved.glossaryHighlightOpacity).toBe(0.6);
  });

  it("is applicationOnly and not offered in Project Settings", () => {
    const entry = getCatalogEntry(OPACITY_KEY);
    expect(entry.scope).toBe("applicationOnly");
    expect(isProjectOverrideEligibleScope(entry.scope)).toBe(false);
    expect(defaultApplicationSettings.preview.glossaryHighlightOpacity).toBe(0.35);
  });

  it("has JA / EN labels and a description saying 0 is transparent, 1 opaque", () => {
    expect(t("ja", "settings.preview.glossaryHighlightOpacity.label")).toBe(
      "ホバーカードハイライトの透明度"
    );
    expect(t("ja", "settings.preview.glossaryHighlightOpacity.description")).toMatch(
      /0.*透明.*1.*不透明/
    );
    expect(t("en", "settings.preview.glossaryHighlightOpacity.description")).toMatch(
      /0 is fully transparent, 1 is fully opaque/
    );
  });
});
