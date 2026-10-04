import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countDocumentCharacters } from "../../src/renderer/characterCount";
import {
  currentCharacterCount,
  resolveCharacterCountSource,
  type KeyedCharacterCount
} from "../../src/renderer/characterCountSource";
import {
  createProjectDocument,
  createUntitledDocument,
  updateCurrentDocumentContent
} from "../../src/renderer/currentDocument";
import {
  createGlossaryDescriptionCurrentEditor,
  createMarkdownCurrentEditor,
  createProjectImageCurrentEditor,
  type CurrentEditor
} from "../../src/renderer/currentEditor";
import { updateGlossaryEntryDraftDescription } from "../../src/renderer/glossaryEntryDraft";
import {
  createGlossaryDescriptionEditorId,
  createUntitledEditorId,
  serializeEditorId
} from "../../src/shared/editorId";
import { formatLocalizedNumber, t } from "../../src/shared/i18n";
import type { GlossaryEntry } from "../../src/shared/glossary";
import type { ProjectDocument } from "../../src/shared/api";
import { defaultApplicationSettings } from "../../src/shared/settings";

const ID_A = "018f4b8c-7a2b-7c3d-8e4f-100000000001";
const ID_B = "018f4b8c-7a2b-7c3d-8e4f-100000000002";
const ts = "2026-10-01T00:00:00.000Z";
const exclude = defaultApplicationSettings.editor.characterCount.exclude;
const includeEverything = {
  whitespace: false,
  lineBreaks: false,
  headings: false,
  markdownSyntax: false,
  markdownComments: false
};

function entry(id: string, description: string): GlossaryEntry {
  return {
    id,
    description,
    atoms: [],
    tags: [],
    createdAt: ts,
    updatedAt: ts
  };
}

function markdownEditor(text: string): CurrentEditor {
  const document = createUntitledDocument();
  return createMarkdownCurrentEditor(
    updateCurrentDocumentContent(document, text, document.lineEndingBreaks)
  );
}

function plainTextEditor(text: string): CurrentEditor {
  return createMarkdownCurrentEditor(
    createProjectDocument(
      { relativePath: "memo.txt", name: "memo.txt" } as ProjectDocument,
      text
    )
  );
}

/** What App does for one active surface: resolve → count with the shared
 *  algorithm → tag the result with the surface's key. */
function computeFor(
  editor: CurrentEditor,
  key: string,
  options = { exclude }
): KeyedCharacterCount | null {
  const source = resolveCharacterCountSource(editor, false);
  if (!source) {
    return null;
  }
  return {
    documentKey: key,
    count: countDocumentCharacters(source.content, source.format, options)
  };
}

describe("character count source resolution (#727)", () => {
  it("resolves a Glossary Description to its live draft as Markdown", () => {
    const saved = createGlossaryDescriptionCurrentEditor(entry("g1", "保存済み"));
    expect(resolveCharacterCountSource(saved, false)).toEqual({
      surface: "glossaryDescription",
      content: "保存済み",
      format: "markdown"
    });

    // A dirty (unsaved) edit is counted, not the stored value.
    const dirty =
      saved.kind === "glossaryDescription"
        ? {
            ...saved,
            draft: updateGlossaryEntryDraftDescription(saved.draft, "編集中の本文です")
          }
        : saved;
    const source = resolveCharacterCountSource(dirty, false);
    expect(source?.content).toBe("編集中の本文です");
    expect(source?.surface).toBe("glossaryDescription");
  });

  it("keeps Markdown and Plain Text as the `document` surface with their own formats", () => {
    expect(resolveCharacterCountSource(markdownEditor("# 見出し"), false)).toMatchObject({
      surface: "document",
      format: "markdown"
    });
    expect(resolveCharacterCountSource(plainTextEditor("本文"), false)).toMatchObject({
      surface: "document",
      format: "plainText",
      content: "本文"
    });
  });

  it("resolves nothing for special tabs and non-text editors", () => {
    const glossary = createGlossaryDescriptionCurrentEditor(entry("g1", "本文"));
    expect(resolveCharacterCountSource(glossary, true)).toBeNull();
    expect(resolveCharacterCountSource(markdownEditor("本文"), true)).toBeNull();
    expect(resolveCharacterCountSource(null, false)).toBeNull();
    expect(
      resolveCharacterCountSource(createProjectImageCurrentEditor("a.png"), false)
    ).toBeNull();
  });
});

describe("Glossary Description uses the Markdown count semantics (#727)", () => {
  const description = "# 見出し\n**太字** <!-- memo -->\n本 文";
  const glossary = createGlossaryDescriptionCurrentEditor(entry("g1", description));

  it("matches the Markdown document count for the same text under every exclude", () => {
    for (const options of [
      { exclude: includeEverything },
      { exclude },
      { exclude: { ...includeEverything, headings: true } },
      { exclude: { ...includeEverything, markdownSyntax: true } },
      { exclude: { ...includeEverything, markdownComments: true } },
      { exclude: { ...includeEverything, whitespace: true, lineBreaks: true } }
    ]) {
      expect(computeFor(glossary, "k", options)?.count).toBe(
        computeFor(markdownEditor(description), "k", options)?.count
      );
    }
  });

  it("reflects editor.characterCount.exclude.* (they change the result)", () => {
    const all = computeFor(glossary, "k", { exclude: includeEverything })!.count;
    const noHeadings = computeFor(glossary, "k", {
      exclude: { ...includeEverything, headings: true }
    })!.count;
    const noBlank = computeFor(glossary, "k", {
      exclude: { ...includeEverything, whitespace: true, lineBreaks: true }
    })!.count;

    expect(noHeadings).toBeLessThan(all);
    expect(noBlank).toBeLessThan(all);
  });

  it("follows edits to the dirty draft", () => {
    const base = createGlossaryDescriptionCurrentEditor(entry("g1", "あ"));
    if (base.kind !== "glossaryDescription") throw new Error("unreachable");
    const typed = {
      ...base,
      draft: updateGlossaryEntryDraftDescription(base.draft, "あいうえお")
    };
    expect(computeFor(base, "k", { exclude: includeEverything })?.count).toBe(1);
    expect(computeFor(typed, "k", { exclude: includeEverything })?.count).toBe(5);
  });
});

describe("stale results never reach another surface (#727)", () => {
  const glossaryA = createGlossaryDescriptionEditorId(ID_A);
  const glossaryB = createGlossaryDescriptionEditorId(ID_B);
  const keyA = serializeEditorId(glossaryA);
  const keyB = serializeEditorId(glossaryB);
  const keyMarkdown = serializeEditorId(createUntitledEditorId(1));
  const keyText = serializeEditorId(createUntitledEditorId(2));

  it("a Markdown result is invisible once Glossary Description B is active (and vice versa)", () => {
    const markdownResult = computeFor(markdownEditor("あいうえお"), keyMarkdown);
    expect(currentCharacterCount(markdownResult, keyMarkdown)).toBe(5);
    expect(currentCharacterCount(markdownResult, keyB)).toBeNull();

    const glossaryResult = computeFor(
      createGlossaryDescriptionCurrentEditor(entry(ID_B, "かき")),
      keyB
    );
    expect(currentCharacterCount(glossaryResult, keyB)).toBe(2);
    expect(currentCharacterCount(glossaryResult, keyMarkdown)).toBeNull();
    expect(currentCharacterCount(glossaryResult, keyText)).toBeNull();
  });

  it("Plain Text → Glossary Description and Glossary A → Glossary B do not mix", () => {
    const textResult = computeFor(plainTextEditor("さしす"), keyText);
    expect(currentCharacterCount(textResult, keyB)).toBeNull();

    const resultA = computeFor(
      createGlossaryDescriptionCurrentEditor(entry(ID_A, "たちつて")),
      keyA
    );
    expect(currentCharacterCount(resultA, keyA)).toBe(4);
    expect(currentCharacterCount(resultA, keyB)).toBeNull();
  });

  it("a special tab or a non-countable editor has no active key, so nothing shows", () => {
    const glossaryResult = computeFor(
      createGlossaryDescriptionCurrentEditor(entry(ID_A, "本文")),
      keyA
    );
    expect(currentCharacterCount(glossaryResult, null)).toBeNull();
    expect(currentCharacterCount(null, keyA)).toBeNull();
  });
});

describe("display reuses the existing header pipeline (#727)", () => {
  it("uses the shared editor.characterCount.display template with the localized number", () => {
    const count = formatLocalizedNumber(12345, "ja");
    expect(t("ja", "editor.characterCount.display", { count })).toBe(
      "12,345文字（概算）"
    );
    expect(
      t("en", "editor.characterCount.display", {
        count: formatLocalizedNumber(12345, "en")
      })
    ).toBe("12,345 char. (approx.)");
  });
});

describe("App wiring (#727)", () => {
  const appSource = readFileSync("src/renderer/App.tsx", "utf8");

  it("has one count call site, one header text, and no glossary-specific counter or string", () => {
    expect(appSource.match(/countDocumentCharacters\(/g)).toHaveLength(1);
    expect(appSource.match(/countMarkdownDocumentCharacters\(/g)).toBeNull();
    expect(appSource.match(/translate\("editor\.characterCount\.display"/g)).toHaveLength(1);
    expect(appSource).toContain("resolveCharacterCountSource(");
    expect(appSource).toContain("currentCharacterCount(");
    expect(appSource).not.toMatch(/glossaryDescription\w*CharacterCount/);
  });

  it("gates the header on `editor.characterCount.visible` for any countable source", () => {
    const start = appSource.indexOf("const editorHeaderWantsCharacterCount");
    const block = appSource.slice(start, start + 160);

    expect(block).toContain("effectiveSettings.editor.characterCount.visible");
    expect(block).toContain("characterCountSource !== null");
    expect(block).not.toContain("statusBar");
  });

  it("keeps Document Metrics on the Markdown / Plain Text `document` surface only", () => {
    const start = appSource.indexOf("const documentMetricsCharacterCountIsActive");
    expect(appSource.slice(start, start + 120)).toContain(
      'characterCountSource?.surface === "document"'
    );
    const metrics = appSource.indexOf("const documentMetricsWantsCharacterCount");
    expect(appSource.slice(metrics, metrics + 140)).toContain(
      "isDocumentMetricsPaneVisible && documentMetricsCharacterCountIsActive"
    );
    expect(appSource.slice(metrics, metrics + 140)).not.toContain(
      "glossaryDescription"
    );
  });
});
