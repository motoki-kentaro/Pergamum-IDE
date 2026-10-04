// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GlossaryPreviewDecorator } from "../../src/renderer/GlossaryPreviewDecorator";
import {
  buildGlossarySurfaceIndex,
  emptyGlossarySurfaceIndex,
  type GlossarySurfaceIndex
} from "../../src/shared/glossarySurfaceMatching";
import { t, type Language, type Translate } from "../../src/shared/i18n";
import type { GlossaryEntry, GlossaryTag } from "../../src/shared/glossary";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-10-05T00:00:00.000Z";
const ID_1 = "018f4b8c-7a2b-7c3d-8e4f-100000000001";

const entries: GlossaryEntry[] = [
  {
    id: ID_1,
    description: "非公開の説明文",
    atoms: ["王都", "帝都", "みやこ"].map((value, sortOrder) => ({
      id: `a${sortOrder}`,
      entryId: ID_1,
      sortOrder,
      value,
      matchFlags: 0,
      createdAt: ts,
      updatedAt: ts
    })),
    tags: [
      { id: "t1", label: "地名", backgroundRgb: "#112233", foregroundRgb: "#ffeedd" },
      { id: "t2", label: "国家", backgroundRgb: "#445566", foregroundRgb: "#ccddee" }
    ] as GlossaryTag[],
    createdAt: ts,
    updatedAt: ts
  }
];

const ID_2 = "018f4b8c-7a2b-7c3d-8e4f-100000000002";
const taglessEntry: GlossaryEntry = {
  id: ID_2,
  description: "",
  atoms: [
    {
      id: "b0",
      entryId: ID_2,
      sortOrder: 0,
      value: "魔王",
      matchFlags: 0,
      createdAt: ts,
      updatedAt: ts
    }
  ],
  tags: [],
  createdAt: ts,
  updatedAt: ts
};
const allEntries = [...entries, taglessEntry];
const allIndex = buildGlossarySurfaceIndex(allEntries);
const surfaceIndex = buildGlossarySurfaceIndex(entries);
const translateFor =
  (language: Language): Translate =>
  (key, values) =>
    t(language, key, values);

describe("Preview glossary decoration + hover card (#731)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderDecorator(options: {
    index: GlossarySurfaceIndex;
    entries?: readonly GlossaryEntry[];
    language?: Language;
    html?: string;
    fallbackColor?: string;
  }): void {
    act(() => {
      root.render(
        <GlossaryPreviewDecorator
          previewHtml={options.html ?? "<p>王都は広い。</p>"}
          surfaceIndex={options.index}
          glossaryEntries={options.entries}
          glossaryFallbackColor={options.fallbackColor}
          translate={translateFor(options.language ?? "ja")}
          documentOpenId={null}
          previewRenderStartedAt={0}
          onPreviewDomCommitted={() => undefined}
          onPreviewDecorationCompleted={() => undefined}
          onPreviewFrameObserved={() => undefined}
        />
      );
    });
  }

  const renderOn = (language: Language = "ja", html?: string) =>
    renderDecorator({ index: surfaceIndex, entries, language, html });
  const renderOff = () =>
    renderDecorator({ index: emptyGlossarySurfaceIndex, entries: undefined });

  const decoration = () =>
    container.querySelector<HTMLElement>(".glossarySurfaceDecoration");
  const card = () => container.querySelector(".glossaryHoverCard");

  function hover(element: Element): void {
    act(() => {
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  }

  function leave(element: Element): void {
    act(() => {
      element.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body
        })
      );
    });
  }

  it("OFF: no decoration wrapper is created and nothing can be hovered", () => {
    renderOff();

    expect(decoration()).toBeNull();
    expect(container.querySelector("article")!.innerHTML).toBe(
      "<p>王都は広い。</p>"
    );
    expect(card()).toBeNull();
  });

  it("ON: matched terms are decorated with their entry id", () => {
    renderOn();

    expect(decoration()?.textContent).toBe("王都");
    expect(decoration()?.dataset.glossaryEntryIds).toBe(ID_1);
  });

  it("toggling ON then OFF removes the decoration from the same preview", () => {
    renderOn();
    expect(decoration()).not.toBeNull();
    renderOff();
    expect(decoration()).toBeNull();
  });

  it("ON: hover shows the card (representative, other atoms, tags); leaving hides it", () => {
    renderOn();
    expect(card()).toBeNull();

    hover(decoration()!);

    expect(card()).not.toBeNull();
    expect(card()!.getAttribute("role")).toBe("tooltip");
    expect(card()!.querySelector(".glossaryHoverCardTitle")!.textContent).toBe(
      "王都"
    );
    expect(card()!.querySelector(".glossaryHoverCardAtoms")!.textContent).toBe(
      "帝都、みやこ"
    );
    expect(card()!.querySelector(".glossaryHoverCardTags")!.textContent).toBe(
      "タグ：地名、国家"
    );
    // The Description is never part of the card.
    expect(card()!.textContent).not.toContain("非公開の説明文");
    // The card lives outside the preview article, so it cannot reflow it.
    expect(container.querySelector("article")!.contains(card())).toBe(false);

    leave(decoration()!);
    expect(card()).toBeNull();
  });

  it("EN uses the English labels", () => {
    renderOn("en");
    hover(decoration()!);

    expect(card()!.querySelector(".glossaryHoverCardAtoms")!.textContent).toBe(
      "帝都, みやこ"
    );
    expect(card()!.querySelector(".glossaryHoverCardTags")!.textContent).toBe(
      "Tags: 地名, 国家"
    );
  });

  it("omits the atoms/tags lines when there are none (no placeholder)", () => {
    const bare: GlossaryEntry[] = [
      { ...entries[0], atoms: [entries[0].atoms[0]], tags: [] }
    ];
    renderDecorator({
      index: buildGlossarySurfaceIndex(bare),
      entries: bare,
      html: "<p>王都</p>"
    });
    hover(decoration()!);

    expect(card()!.querySelector(".glossaryHoverCardTitle")!.textContent).toBe(
      "王都"
    );
    expect(card()!.querySelector(".glossaryHoverCardAtoms")).toBeNull();
    expect(card()!.querySelector(".glossaryHoverCardTags")).toBeNull();
  });

  it("closes when the preview content is replaced", () => {
    renderOn();
    hover(decoration()!);
    expect(card()).not.toBeNull();

    renderOn("ja", "<p>別の本文</p>");
    expect(card()).toBeNull();
  });
});

describe("Preview glossary decoration colours (#731)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderColors(fallbackColor?: string, opacity?: number): void {
    act(() => {
      root.render(
        <GlossaryPreviewDecorator
          previewHtml="<p>王都と魔王。</p>"
          surfaceIndex={allIndex}
          glossaryEntries={allEntries}
          glossaryFallbackColor={fallbackColor}
          glossaryHighlightOpacity={opacity}
          translate={translateFor("ja")}
          documentOpenId={null}
          previewRenderStartedAt={0}
          onPreviewDomCommitted={() => undefined}
          onPreviewDecorationCompleted={() => undefined}
          onPreviewFrameObserved={() => undefined}
        />
      );
    });
  }

  const spans = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>(".glossarySurfaceDecoration")
    );
  const article = () => container.querySelector("article")!;
  const containerVar = (name: string) => article().style.getPropertyValue(name);

  it("a tagged entry uses its FIRST tag's stored RGB and foreground, nothing from later tags", () => {
    renderColors();
    const tagged = spans().find((el) => el.textContent === "王都")!;

    // Background channels of the first tag (#112233); foreground verbatim.
    expect(tagged.style.getPropertyValue("--glossary-decoration-rgb")).toBe(
      "17 34 51"
    );
    expect(tagged.style.getPropertyValue("color")).toBe("#ffeedd");
    // Nothing from the second tag (#445566 / #ccddee) leaks in.
    expect(tagged.outerHTML).not.toMatch(/445566|68 85 102|ccddee/);
    expect(tagged.dataset.glossaryTagless).toBeUndefined();
    expect(tagged.style.getPropertyValue("border-bottom")).toBe("");
    // The stored tag colours are not rewritten.
    expect(entries[0].tags[0].backgroundRgb).toBe("#112233");
  });

  it("an untagged entry is painted from documentMap.glossaryFallbackColor with an auto foreground", () => {
    renderColors("#ffffcc");
    const untagged = spans().find((el) => el.textContent === "魔王")!;

    expect(untagged.dataset.glossaryTagless).toBe("true");
    expect(untagged.style.getPropertyValue("--glossary-decoration-rgb")).toBe("");
    // Light fallback → black text, the same YIQ policy as a new tag's foreground.
    expect(containerVar("--glossary-decoration-fallback-rgb")).toBe("255 255 204");
    expect(containerVar("--glossary-decoration-fallback-foreground")).toBe(
      "#000000"
    );

    renderColors("#101030");
    expect(containerVar("--glossary-decoration-fallback-rgb")).toBe("16 16 48");
    expect(containerVar("--glossary-decoration-fallback-foreground")).toBe(
      "#ffffff"
    );
  });

  it("falls back to the built-in Document Map colour when the setting is absent or invalid", () => {
    renderColors("not-a-color");
    expect(containerVar("--glossary-decoration-fallback-rgb")).toMatch(
      /^\d+ \d+ \d+$/
    );
  });

  it.each([
    [0, "0"],
    [0.05, "0.05"],
    [0.35, "0.35"],
    [1, "1"]
  ])(
    "highlight opacity %s is exposed as the background alpha only (variable %s)",
    (opacity, expected) => {
      renderColors("#ffffcc", opacity);
      const tagged = spans().find((el) => el.textContent === "王都")!;

      expect(containerVar("--glossary-highlight-opacity")).toBe(expected);
      // The foreground is a plain colour: no alpha is ever applied to it.
      expect(tagged.style.getPropertyValue("color")).toBe("#ffeedd");
      expect(containerVar("--glossary-decoration-fallback-foreground")).not.toContain(
        "var("
      );
    }
  );

  it("defaults to the catalog opacity and clamps an out-of-range value", () => {
    renderColors("#ffffcc");
    expect(containerVar("--glossary-highlight-opacity")).toBe("0.35");

    renderColors("#ffffcc", 7);
    expect(containerVar("--glossary-highlight-opacity")).toBe("1");
    renderColors("#ffffcc", -1);
    expect(containerVar("--glossary-highlight-opacity")).toBe("0");
  });

  it("repaints live when the opacity changes, without re-decorating", () => {
    renderColors("#ffffcc", 0.35);
    const before = spans()[0];
    renderColors("#ffffcc", 0.6);

    expect(spans()[0]).toBe(before);
    expect(containerVar("--glossary-highlight-opacity")).toBe("0.6");
  });
});

describe("Preview glossary styling source (#731)", () => {
  const css = readFileSync("src/renderer/styles.css", "utf8");
  const ruleBlock = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start)).replace(/\/\*[\s\S]*?\*\//g, "");
  };

  it("the decoration composes alpha onto the background only; no border/underline, no hard-coded colour", () => {
    const block = ruleBlock(".glossarySurfaceDecoration");
    expect(block).toContain("var(--glossary-highlight-opacity)");
    expect(block).toMatch(/background-color:\s*rgb\(/);
    expect(block).toContain("color: var(--glossary-decoration-fallback-foreground)");
    expect(block).not.toMatch(/border|underline|rgba|#[0-9a-fA-F]{3,8}/);
    // Alpha never reaches the foreground.
    expect(block).not.toMatch(/[^-]color:[^;]*opacity/);
  });

  it("the hover card is neutral: it uses the editor tooltip tokens, not tag or ad-hoc colours", () => {
    const card = ruleBlock(".glossaryHoverCard");
    expect(card).toContain("var(--pg-color-editor-tooltip-background)");
    expect(card).toContain("var(--pg-color-editor-tooltip-foreground)");
    expect(card).toContain("var(--pg-color-editor-tooltip-border)");
    expect(card).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const selector of [".glossaryHoverCardTitle", ".glossaryHoverCardAtoms", ".glossaryHoverCardEntry + .glossaryHoverCardEntry"]) {
      expect(ruleBlock(selector)).not.toMatch(/color\s*:\s*(?!var\(--pg-color-editor-tooltip)/);
    }
  });

  it("the decorator no longer claims the hover card was removed", () => {
    const source = readFileSync("src/renderer/GlossaryPreviewDecorator.tsx", "utf8");
    expect(source).not.toMatch(/intentionally gone|hover card \/ tooltip is/);
    expect(css).not.toContain("there is no hover card");
  });

  it("Document Map Settings explain that the fallback colour is also used by the Preview decoration", () => {
    expect(t("ja", "settings.documentMap.glossaryFallbackColor.description")).toBe(
      "文書マップと、プレビューの語彙ホバーカード装飾で、タグなし語彙に使用する色です。"
    );
    expect(t("en", "settings.documentMap.glossaryFallbackColor.description")).toMatch(
      /Document Map.*Preview/
    );
  });
});
