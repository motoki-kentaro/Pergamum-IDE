// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { SettingsPanel } from "../../src/renderer/SettingsPanel";
import {
  buildSettingsItemEntries,
  editorSettingsItemGroups
} from "../../src/renderer/settingsItemGroups";
import { defaultApplicationSettings } from "../../src/shared/settings";
import { settingCatalogItems } from "../../src/shared/settingsUiCatalog";
import { t, type Language, type Translate } from "../../src/shared/i18n";

const nonPrintingKeys = [
  "editor.whitespace.renderIdeographicSpace",
  "editor.whitespace.renderAsciiSpace",
  "editor.whitespace.renderTab",
  "editor.whitespace.renderOtherUnicodeSpace"
];
const exclusionKeys = [
  "editor.characterCount.exclude.whitespace",
  "editor.characterCount.exclude.lineBreaks",
  "editor.characterCount.exclude.headings",
  "editor.characterCount.exclude.markdownSyntax",
  "editor.characterCount.exclude.markdownComments"
];

function translateFor(language: Language): Translate {
  return (key, values) => t(language, key, values);
}

describe("Editor settings collapsible groups (#721)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChangeSettings = vi.fn();

  function render(
    language: Language = "ja",
    onChange: typeof onChangeSettings = onChangeSettings
  ): void {
    act(() => {
      root.render(
        <SettingsPanel
          settings={defaultApplicationSettings}
          isLoading={false}
          error={null}
          translate={translateFor(language)}
          onChangeSettings={onChange}
        />
      );
    });
  }

  function selectCategory(label: string): void {
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settingsCategoryButton")
    ).find((candidate) => candidate.textContent?.trim() === label);
    expect(button).toBeDefined();
    act(() => button!.click());
  }

  function selectEditorCategory(language: Language = "ja"): void {
    selectCategory(translateFor(language)("settings.category.editor.label"));
  }

  function headers(): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".settingsCollapsibleGroupHeader"
      )
    );
  }

  function control(key: string): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>(
      `#settingControl-${CSS.escape(key)}`
    );
  }

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

  it("starts with both groups collapsed and their controls hidden", () => {
    render();
    selectEditorCategory();

    const [nonPrinting, exclusions] = headers();
    expect(headers()).toHaveLength(2);
    expect(nonPrinting.textContent).toBe("非文字表示設定");
    expect(exclusions.textContent).toBe("文字数カウント除外設定");
    expect(nonPrinting.getAttribute("aria-expanded")).toBe("false");
    expect(exclusions.getAttribute("aria-expanded")).toBe("false");
    for (const key of [...nonPrintingKeys, ...exclusionKeys]) {
      expect(control(key)).toBeNull();
    }
    // The ungrouped sibling setting stays visible.
    expect(control("editor.characterCount.visible")).not.toBeNull();
  });

  it("expands on click and collapses on a second click, switching the chevron", () => {
    render();
    selectEditorCategory();
    const nonPrinting = headers()[0];
    const collapsedChevron = nonPrinting.querySelector(
      ".settingsCollapsibleGroupChevron"
    )!.innerHTML;

    act(() => nonPrinting.click());
    expect(nonPrinting.getAttribute("aria-expanded")).toBe("true");
    for (const key of nonPrintingKeys) {
      expect(control(key)).not.toBeNull();
    }
    const expandedChevron = nonPrinting.querySelector(
      ".settingsCollapsibleGroupChevron"
    )!.innerHTML;
    expect(expandedChevron).not.toBe(collapsedChevron);

    act(() => nonPrinting.click());
    expect(nonPrinting.getAttribute("aria-expanded")).toBe("false");
    expect(control(nonPrintingKeys[0])).toBeNull();
    expect(
      nonPrinting.querySelector(".settingsCollapsibleGroupChevron")!.innerHTML
    ).toBe(collapsedChevron);
  });

  it("is a native button, so Enter/Space activate it from the keyboard", () => {
    render();
    selectEditorCategory();
    const [nonPrinting] = headers();

    expect(nonPrinting.tagName).toBe("BUTTON");
    expect(nonPrinting.getAttribute("type")).toBe("button");
    expect(nonPrinting.getAttribute("aria-controls")).toBe(
      "settingsGroupBody-nonPrintingCharacters"
    );
    // Whole heading row (chevron + title) lives inside the one button.
    expect(
      nonPrinting.querySelector(".settingsCollapsibleGroupChevron")
    ).not.toBeNull();
    expect(
      nonPrinting.querySelector(".settingsCollapsibleGroupTitle")
    ).not.toBeNull();
  });

  it("opens both groups independently (no accordion)", () => {
    render();
    selectEditorCategory();
    const [nonPrinting, exclusions] = headers();

    act(() => nonPrinting.click());
    act(() => exclusions.click());
    expect(nonPrinting.getAttribute("aria-expanded")).toBe("true");
    expect(exclusions.getAttribute("aria-expanded")).toBe("true");

    act(() => nonPrinting.click());
    expect(nonPrinting.getAttribute("aria-expanded")).toBe("false");
    expect(exclusions.getAttribute("aria-expanded")).toBe("true");
    for (const key of exclusionKeys) {
      expect(control(key)).not.toBeNull();
    }
  });

  it("keeps controls inside an expanded group working", () => {
    render();
    selectEditorCategory();
    act(() => headers()[0].click());

    const tab = control("editor.whitespace.renderTab")!;
    act(() => tab.click());

    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    expect(
      onChangeSettings.mock.calls[0][0].editor.whitespace.renderTab
    ).toBe(!defaultApplicationSettings.editor.whitespace.renderTab);
  });

  it("resets to collapsed after leaving and re-entering the category", () => {
    render();
    selectEditorCategory();
    act(() => headers()[0].click());
    expect(headers()[0].getAttribute("aria-expanded")).toBe("true");

    selectCategory(translateFor("ja")("settings.category.application.label"));
    expect(headers()).toHaveLength(0);
    selectEditorCategory();
    expect(headers()[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("uses English group names", () => {
    render("en");
    selectEditorCategory("en");

    expect(headers().map((header) => header.textContent)).toEqual([
      "Non-printing character display",
      "Character count exclusions"
    ]);
  });

  it("never hides a searched setting inside a collapsed group", () => {
    render();
    const input = container.querySelector<HTMLInputElement>(
      "#settingsSearchInput"
    )!;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      nativeSetter?.call(input, "editor.whitespace.renderTab");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(headers()).toHaveLength(0);
    expect(control("editor.whitespace.renderTab")).not.toBeNull();
  });
});

describe("settings item grouping helper (#721)", () => {
  const editorItems = settingCatalogItems
    .filter((item) => item.category === "editor")
    .sort((a, b) => a.order - b.order);

  it("targets exactly the nine intended keys", () => {
    expect(
      editorSettingsItemGroups.map((group) => [...group.keys])
    ).toEqual([nonPrintingKeys, exclusionKeys]);
  });

  it("folds each group's items into one entry without losing or reordering others", () => {
    const entries = buildSettingsItemEntries(editorItems);
    const groups = entries.filter((entry) => entry.kind === "group");

    expect(groups).toHaveLength(2);
    const flattened = entries.flatMap((entry) =>
      entry.kind === "group" ? entry.items : [entry.item]
    );
    expect(flattened.map((item) => item.key).sort()).toEqual(
      editorItems.map((item) => item.key).sort()
    );
    const plain = entries
      .filter((entry) => entry.kind === "item")
      .map((entry) => (entry.kind === "item" ? entry.item.key : ""));
    expect(plain).toEqual(
      editorItems
        .map((item) => item.key)
        .filter((key) => ![...nonPrintingKeys, ...exclusionKeys].includes(key))
    );
  });

  it("adds no persisted state: the group component is local UI state only", () => {
    const source = readFileSync(
      "src/renderer/components/SettingsCollapsibleGroup.tsx",
      "utf8"
    );

    expect(source).toContain("useState(false)");
    expect(source).not.toMatch(/localStorage|sessionStorage|onChangeSettings/);
    expect(readFileSync("src/shared/settingsCatalog.ts", "utf8")).not.toMatch(
      /settings\.editor\.group|collapsed|expanded/i
    );
  });
});
