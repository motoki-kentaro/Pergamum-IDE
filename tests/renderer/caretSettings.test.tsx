// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CARET_WIDTH, CARET_BLINK } from "../../src/shared/caretSettings";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, drawSelection, getDrawSelectionConfig } from "@codemirror/view";
import {
  DEFAULT_CARET_BLINK_RATE,
  DEFAULT_CARET_WIDTH,
  MAX_CARET_BLINK_RATE,
  MIN_CARET_BLINK_RATE,
  MIN_CARET_WIDTH,
  STEP_CARET_BLINK_RATE,
  applyTextCursorSettingsToDom,
  caretBlinkCompartment,
  createCaretBlinkExtension,
  createPreviewUnfocusedCaretExtension
} from "../../src/renderer/caretSettingsCodeMirror";
import { CaretSettingsSection } from "../../src/renderer/components/CaretSettingsSection";
import { SettingsPanelView } from "../../src/renderer/SettingsPanel";
import {
  defaultApplicationSettings,
  type ApplicationSettings,
  type SaveApplicationSettingsRequest
} from "../../src/shared/settings";
import { jaTranslations } from "../../src/shared/i18n/ja";
import { enTranslations } from "../../src/shared/i18n/en";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function changeInputValue(input: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Text cursor settings (#719)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    document.documentElement.style.removeProperty("--pergamum-text-cursor-color");
    document.documentElement.style.removeProperty("--pergamum-text-cursor-width");
  });

  describe("CodeMirror extension helpers and DOM application", () => {
    it("verifies installed CodeMirror drawSelection default cursorBlinkRate is 1200ms", () => {
      const state = EditorState.create({
        extensions: [drawSelection()]
      });
      const conf = getDrawSelectionConfig(state);
      expect(conf.cursorBlinkRate).toBe(1200);
      expect(DEFAULT_CARET_BLINK_RATE).toBe(conf.cursorBlinkRate);
    });

    it("configures blink disabled when cursorBlinkRate is 0 and preserves state across reconfigure", () => {
      const initialText = "点滅テスト";
      const view = new EditorView({
        state: EditorState.create({
          doc: initialText,
          selection: EditorSelection.cursor(2),
          extensions: [
            caretBlinkCompartment.of(createCaretBlinkExtension(DEFAULT_CARET_BLINK_RATE))
          ]
        }),
        parent: container
      });

      try {
        expect(getDrawSelectionConfig(view.state).cursorBlinkRate).toBe(1200);

        // Reconfigure to 0ms (disabled)
        view.dispatch({
          effects: caretBlinkCompartment.reconfigure(createCaretBlinkExtension(0))
        });
        expect(getDrawSelectionConfig(view.state).cursorBlinkRate).toBe(0);
        expect(view.state.doc.toString()).toBe(initialText);
        expect(view.state.selection.main.head).toBe(2);

        // Reconfigure to 600ms
        view.dispatch({
          effects: caretBlinkCompartment.reconfigure(createCaretBlinkExtension(600))
        });
        expect(getDrawSelectionConfig(view.state).cursorBlinkRate).toBe(600);
        expect(view.state.doc.toString()).toBe(initialText);
        expect(view.state.selection.main.head).toBe(2);
      } finally {
        view.destroy();
      }
    });

    it("applies CSS variables to documentElement via applyTextCursorSettingsToDom", () => {
      applyTextCursorSettingsToDom({ style: "line", width: 3, blink: 600 });
      expect(document.documentElement.style.getPropertyValue("--pergamum-text-cursor-width")).toBe("3px");
      expect(document.documentElement.style.getPropertyValue("--pergamum-text-cursor-color")).toBe("");

    });
  });

  describe("CaretSettingsSection component", () => {
    it("renders Japanese initial sample text when displayLanguage is ja", () => {
      act(() => {
        root?.render(
          <CaretSettingsSection
            settings={defaultApplicationSettings}
            isLoading={false}
            displayLanguage="ja"
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={() => undefined}
          />
        );
      });

      const editorEl = container.querySelector(".caretPreviewEditorHost");
      expect(editorEl).not.toBeNull();
      expect(editorEl?.textContent).toContain("サンプル文書です");
    });

    it("renders English initial sample text when displayLanguage is en", () => {
      act(() => {
        root?.render(
          <CaretSettingsSection
            settings={defaultApplicationSettings}
            isLoading={false}
            displayLanguage="en"
            translate={(key) => (enTranslations as any)[key] ?? key}
            onChangeSettings={() => undefined}
          />
        );
      });

      const editorEl = container.querySelector(".caretPreviewEditorHost");
      expect(editorEl).not.toBeNull();
      expect(editorEl?.textContent).toContain("This is a sample document.");
    });

    it("allows editing in the mini preview without making it read-only", () => {
      act(() => {
        root?.render(
          <CaretSettingsSection
            settings={defaultApplicationSettings}
            isLoading={false}
            displayLanguage="ja"
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={() => undefined}
          />
        );
      });

      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content).not.toBeNull();
      expect(content.getAttribute("contenteditable")).toBe("true");
    });

    it("destroys EditorView when unmounted", () => {
      const destroySpy = vi.spyOn(EditorView.prototype, "destroy");
      try {
        act(() => {
          root?.render(
            <CaretSettingsSection
              settings={defaultApplicationSettings}
              isLoading={false}
              displayLanguage="ja"
              translate={(key) => (jaTranslations as any)[key] ?? key}
              onChangeSettings={() => undefined}
            />
          );
        });

        expect(destroySpy).not.toHaveBeenCalled();

        act(() => {
          root?.unmount();
          root = null;
        });

        expect(destroySpy).toHaveBeenCalled();
      } finally {
        destroySpy.mockRestore();
      }
    });

    it("updates width and notifies onChangeSettings", () => {
      const onChangeSpy = vi.fn();
      act(() => {
        root?.render(
          <CaretSettingsSection
            settings={defaultApplicationSettings}
            isLoading={false}
            displayLanguage="ja"
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={onChangeSpy}
          />
        );
      });

      const slider = container.querySelector(
        "[data-testid='caretWidthSlider']"
      ) as HTMLInputElement;
      const numberInput = container.querySelector(
        "[data-testid='caretWidthNumberInput']"
      ) as HTMLInputElement;

      expect(slider).not.toBeNull();
      expect(numberInput).not.toBeNull();
      expect(slider.value).toBe(String(DEFAULT_CARET_WIDTH));
      expect(numberInput.value).toBe(String(DEFAULT_CARET_WIDTH));

      act(() => {
        changeInputValue(slider, "4");
      });
      expect(onChangeSpy).toHaveBeenCalled();
      const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0] as SaveApplicationSettingsRequest;
      expect(lastCall.textCursor?.width).toBe(4);
    });

    it("updates blink interval with 200ms step and notifies onChangeSettings", () => {
      const onChangeSpy = vi.fn();
      act(() => {
        root?.render(
          <CaretSettingsSection
            settings={defaultApplicationSettings}
            isLoading={false}
            displayLanguage="ja"
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={onChangeSpy}
          />
        );
      });

      const slider = container.querySelector(
        "[data-testid='caretBlinkSlider']"
      ) as HTMLInputElement;
      const numberInput = container.querySelector(
        "[data-testid='caretBlinkNumberInput']"
      ) as HTMLInputElement;

      expect(slider.min).toBe(String(MIN_CARET_BLINK_RATE));
      expect(slider.max).toBe(String(MAX_CARET_BLINK_RATE));
      expect(slider.step).toBe(String(STEP_CARET_BLINK_RATE));
      expect(slider.value).toBe(String(DEFAULT_CARET_BLINK_RATE));
      expect(numberInput.value).toBe(String(DEFAULT_CARET_BLINK_RATE));

      act(() => {
        changeInputValue(slider, "400");
      });
      expect(onChangeSpy).toHaveBeenCalled();
      const lastCall = onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1][0] as SaveApplicationSettingsRequest;
      expect(lastCall.textCursor?.blink).toBe(400);
    });


  });

  describe("#719 audit regressions", () => {
    it("keeps theme colors and drop cursor independent of width", () => {
      const source = readFileSync("src/renderer/editorThemeExtension.ts", "utf8");
      expect(source).not.toContain("--pergamum-text-cursor-color");
      expect(source).toContain('caretColor: "var(--pg-color-editor-caret)"');
      const dropRule = source.split('".cm-dropCursor": {')[1]?.split("}")[0];
      expect(dropRule).toContain("--pg-color-editor-drop-cursor");
      expect(dropRule).not.toContain("width");
      expect(source).not.toContain('".cm-cursor, .cm-dropCursor"');
    });

    it.each([false, true])("validates numeric drafts in dedicated/search UI (search=%s)", (search) => {
      const onChange = vi.fn();
      act(() => root?.render(<SettingsPanelView settings={defaultApplicationSettings}
        isLoading={false} error={null} translate={(key) => jaTranslations[key]}
        onChangeSettings={onChange} selectedCategoryId="textCursor"
        onSelectCategory={() => undefined} searchQuery={search ? "textCursor" : ""}
        onSearchQueryChange={() => undefined} />));
      const width = container.querySelector("[data-testid='caretWidthNumberInput']") as HTMLInputElement;
      const blink = container.querySelector("[data-testid='caretBlinkNumberInput']") as HTMLInputElement;
      if (search) {
        expect(width.id).toBe("settingControl-textCursor.width");
        expect(blink.id).toBe("settingControl-textCursor.blink");
      }
      for (const [input, range] of [[width, CARET_WIDTH], [blink, CARET_BLINK]] as const) {
        expect(input.min).toBe(String(range.min)); expect(input.max).toBe(String(range.max));
        expect(input.step).toBe(String(range.step));
      }
      for (const [input, value] of [[width, "100"], [width, "1.5"], [blink, "500"], [blink, "2200"], [blink, ""]] as const) {
        onChange.mockClear();
        act(() => changeInputValue(input, value));
        expect(onChange).not.toHaveBeenCalled();
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(container.querySelector("[role='alert']")).not.toBeNull();
      }
      act(() => changeInputValue(blink, "600"));
      expect(onChange.mock.calls.at(-1)?.[0].textCursor.blink).toBe(600);
      expect(blink.getAttribute("aria-invalid")).toBe("false");
      expect(container.querySelector("[type='color']")).toBeNull();
    });

    it("live updates preview speed and zero without replacing its state", async () => {
      function render(blink: number): void {
        act(() => root?.render(<CaretSettingsSection
          settings={{ ...defaultApplicationSettings, textCursor: { style: "line", width: 1, blink } }}
          isLoading={false} displayLanguage="ja" translate={(key) => jaTranslations[key]}
          onChangeSettings={() => undefined} />));
      }
      render(1200);
      const view = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "追加" } }));
      const doc = view.state.doc.toString();
      for (const blink of [400, 0, 600]) {
        render(blink);
        expect(EditorView.findFromDOM(container.querySelector(".cm-content")!)).toBe(view);
        expect(getDrawSelectionConfig(view.state).cursorBlinkRate).toBe(blink);
        expect(view.state.doc.toString()).toBe(doc);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        const layer = view.scrollDOM.querySelector(".cm-cursorLayer") as HTMLElement;
        expect(layer).not.toBeNull();
        const style = window.getComputedStyle(layer);
        if (blink === 0) expect(style.animation).toBe("none");
        else expect(style.animationDuration).toBe(`${blink}ms`);
      }
    });
  });

  describe("SettingsPanelView integration", () => {
    it("shows all three command paths consistently in the dedicated section", () => {
      act(() => root?.render(<CaretSettingsSection settings={defaultApplicationSettings}
        isLoading={false} displayLanguage="ja" translate={key => jaTranslations[key]}
        onChangeSettings={() => undefined} />));
      const rows = [...container.querySelectorAll(".caretSettingRow")];
      expect(rows).toHaveLength(3);
      expect(rows.map(row => row.querySelector("code.settingsItemKey")?.textContent))
        .toEqual(["textCursor.style", "textCursor.width", "textCursor.blink"]);
      for (const row of rows) {
        expect(row.lastElementChild?.className).toBe("settingsItemKey");
        expect(row.querySelector("select, .caretSettingInputGroup")).not.toBeNull();
      }
      expect(container.querySelectorAll(".caretSettingSlider")).toHaveLength(2);
      expect(container.querySelector(".caretPreviewEditorHost .cm-editor")).not.toBeNull();
    });

    it.each(["width", "blink"] as const)("finds and edits textCursor.%s through its command path", field => {
      const onChange = vi.fn();
      act(() => root?.render(<SettingsPanelView settings={defaultApplicationSettings}
        isLoading={false} error={null} translate={key => jaTranslations[key]}
        onChangeSettings={onChange} selectedCategoryId="textCursor"
        onSelectCategory={() => undefined} searchQuery={`textCursor.${field}`}
        onSearchQueryChange={() => undefined} />));
      expect([...container.querySelectorAll(".settingsItemKey")].map(path => path.textContent))
        .toEqual([`textCursor.${field}`]);
      const input = container.querySelector<HTMLInputElement>("input[type='number']")!;
      expect(input.id).toBe(`settingControl-textCursor.${field}`);
      const value = field === "width" ? 15 : 800;
      act(() => changeInputValue(input, String(value)));
      expect(onChange.mock.calls.at(-1)?.[0].textCursor[field]).toBe(value);
    });

    it.each(["", "textCursor.style", "スタイル"])("exposes the style label and command path via Settings (search=%s)", searchQuery => {
      const onChange = vi.fn();
      act(() => root?.render(<SettingsPanelView settings={defaultApplicationSettings}
        isLoading={false} error={null} translate={key => jaTranslations[key]}
        onChangeSettings={onChange} selectedCategoryId="textCursor"
        onSelectCategory={() => undefined} searchQuery={searchQuery}
        onSearchQueryChange={() => undefined} />));
      const path = [...container.querySelectorAll(".settingsItemKey")]
        .find(element => element.textContent === "textCursor.style");
      expect(path).toBeDefined();
      const row = path!.parentElement!;
      expect(row.textContent).toContain("スタイル");
      expect(row.textContent).toContain("テキストカーソルの表示スタイル");
      expect(row.textContent).not.toContain("キャレット");
      const select = row.querySelector<HTMLSelectElement>("select")!;
      expect(select).not.toBeNull();
      act(() => { select.value = "block"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(onChange.mock.calls.at(-1)?.[0].textCursor.style).toBe("block");
    });

    it("uses consistent English style wording", () => {
      expect(enTranslations["settings.textCursor.style.label"]).toBe("Style");
      expect(enTranslations["settings.textCursor.style.description"]).toContain("text cursor");
      expect(enTranslations["settings.textCursor.style.description"].toLowerCase()).not.toContain("caret");
    });

    it("live updates the real Block preview and preserves the saved Line width", () => {
      const onChange = vi.fn();
      function render(style: "line" | "block", blink: number): void {
        act(() => root?.render(<CaretSettingsSection settings={{ ...defaultApplicationSettings,
          textCursor: { style, width: 9, blink } }} isLoading={false} displayLanguage="en"
          translate={key => enTranslations[key]} onChangeSettings={onChange} />));
      }
      render("line", 1200);
      const view = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
      const doc = view.state.doc;
      for (const blink of [1200, 0, 400]) {
        render("block", blink);
        expect(EditorView.findFromDOM(container.querySelector(".cm-content")!)).toBe(view);
        const mark = container.querySelector<HTMLElement>(".pg-block-caret-text")!;
        expect(mark).not.toBeNull();
        expect(mark.style.animationDuration).toBe(`${blink}ms`);
        expect(mark.style.animationName === "none").toBe(blink === 0);
        expect((container.querySelector("[data-testid='caretWidthSlider']") as HTMLInputElement).disabled).toBe(true);
        expect((container.querySelector("[data-testid='caretBlinkSlider']") as HTMLInputElement).disabled).toBe(false);
        expect(view.state.doc).toBe(doc);
      }
      render("line", 400);
      expect(container.querySelector(".pg-block-caret-text")).toBeNull();
      const width = container.querySelector<HTMLInputElement>("[data-testid='caretWidthNumberInput']")!;
      expect(width.disabled).toBe(false); expect(width.value).toBe("9");
      const select = container.querySelector<HTMLSelectElement>("#caretStyleSelect")!;
      act(() => { select.value = "block"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(onChange.mock.calls.at(-1)?.[0].textCursor).toEqual({ style: "block", width: 9, blink: 400 });
    });

    it("disables width in searched settings while retaining its value", () => {
      act(() => root?.render(<SettingsPanelView settings={{ ...defaultApplicationSettings,
        textCursor: { style: "block", width: 9, blink: 1200 } }} isLoading={false} error={null}
        translate={key => enTranslations[key]} onChangeSettings={() => undefined}
        selectedCategoryId="textCursor" onSelectCategory={() => undefined}
        searchQuery="textCursor" onSearchQueryChange={() => undefined} />));
      const width = container.querySelector<HTMLInputElement>("[data-testid='caretWidthNumberInput']")!;
      expect(width.disabled).toBe(true); expect(width.value).toBe("9");
      expect(container.querySelector("#settingControl-textCursor\\.style")).not.toBeNull();
    });

    it("renders CaretSettingsSection when textCursor category is selected and not searching, without duplicating catalog item rows", () => {
      act(() => {
        root?.render(
          <SettingsPanelView
            settings={defaultApplicationSettings}
            isLoading={false}
            error={null}
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={() => undefined}
            selectedCategoryId="textCursor"
            onSelectCategory={() => undefined}
            searchQuery=""
            onSearchQueryChange={() => undefined}
          />
        );
      });

      expect(container.querySelector(".caretSettingsSection")).not.toBeNull();
      // Must not duplicate with generic settingItemList
      expect(container.querySelector(".settingsItemList")).toBeNull();
    });

    it("does not render CaretSettingsSection when another category (e.g. editor) is selected", () => {
      act(() => {
        root?.render(
          <SettingsPanelView
            settings={defaultApplicationSettings}
            isLoading={false}
            error={null}
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={() => undefined}
            selectedCategoryId="editor"
            onSelectCategory={() => undefined}
            searchQuery=""
            onSearchQueryChange={() => undefined}
          />
        );
      });

      expect(container.querySelector(".caretSettingsSection")).toBeNull();
      expect(container.querySelector(".settingsItemList")).not.toBeNull();
    });

    it("does not render CaretSettingsSection when searching", () => {
      act(() => {
        root?.render(
          <SettingsPanelView
            settings={defaultApplicationSettings}
            isLoading={false}
            error={null}
            translate={(key) => (jaTranslations as any)[key] ?? key}
            onChangeSettings={() => undefined}
            selectedCategoryId="textCursor"
            onSelectCategory={() => undefined}
            searchQuery="カーソル"
            onSearchQueryChange={() => undefined}
          />
        );
      });

      expect(container.querySelector(".caretSettingsSection")).toBeNull();
    });
  });
});
