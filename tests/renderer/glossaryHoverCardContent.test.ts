import { describe, expect, it } from "vitest";
import {
  buildGlossaryHoverCardContents,
  buildGlossaryHoverCardEntryContent
} from "../../src/renderer/glossaryHoverCardContent";
import type { GlossaryEntry, GlossaryTag } from "../../src/shared/glossary";

const ts = "2026-10-05T00:00:00.000Z";
const ID_1 = "018f4b8c-7a2b-7c3d-8e4f-100000000001";
const ID_2 = "018f4b8c-7a2b-7c3d-8e4f-100000000002";

function tag(id: string, label: string): GlossaryTag {
  return {
    id,
    label,
    description: null,
    backgroundRgb: "#000000",
    foregroundRgb: "#ffffff"
  } as GlossaryTag;
}

function entry(
  id: string,
  values: readonly string[],
  tags: readonly GlossaryTag[] = [],
  description = "説明文は表示されない"
): GlossaryEntry {
  return {
    id,
    description,
    atoms: values.map((value, index) => ({
      id: `${id}-a${index}`,
      entryId: id,
      sortOrder: index,
      value,
      matchFlags: 0,
      createdAt: ts,
      updatedAt: ts
    })),
    tags: [...tags],
    createdAt: ts,
    updatedAt: ts
  };
}

describe("glossary hover card content (#731)", () => {
  it("representative atom only: no other atoms, no tags", () => {
    expect(buildGlossaryHoverCardEntryContent(entry(ID_1, ["王都"]))).toEqual({
      entryId: ID_1,
      representative: "王都",
      otherAtoms: [],
      tags: []
    });
  });

  it("representative + several atoms, in registered order", () => {
    const content = buildGlossaryHoverCardEntryContent(
      entry(ID_1, ["王都", "帝都", "首都", "みやこ"])
    );
    expect(content?.representative).toBe("王都");
    expect(content?.otherAtoms).toEqual(["帝都", "首都", "みやこ"]);
  });

  it("uses sortOrder, not array position, for the order", () => {
    const e = entry(ID_1, ["b", "a", "c"]);
    e.atoms[0].sortOrder = 2;
    e.atoms[1].sortOrder = 0;
    e.atoms[2].sortOrder = 1;
    const content = buildGlossaryHoverCardEntryContent(e);
    expect(content?.representative).toBe("a");
    expect(content?.otherAtoms).toEqual(["c", "b"]);
  });

  it("lists assigned tags in assignment order; no tags → empty", () => {
    const withTags = buildGlossaryHoverCardEntryContent(
      entry(ID_1, ["王都"], [tag("t2", "地名"), tag("t1", "国家")])
    );
    expect(withTags?.tags).toEqual(["地名", "国家"]);
    expect(
      buildGlossaryHoverCardEntryContent(entry(ID_1, ["王都"]))?.tags
    ).toEqual([]);
  });

  it("never carries the Description", () => {
    const content = buildGlossaryHoverCardEntryContent(
      entry(ID_1, ["王都"], [], "秘密の説明")
    );
    expect(JSON.stringify(content)).not.toContain("秘密の説明");
    expect(content).not.toHaveProperty("description");
  });

  it("resolves distinct entries in candidate order and skips unknown ids", () => {
    const entries = [entry(ID_1, ["王都"]), entry(ID_2, ["王都", "帝都"])];
    expect(
      buildGlossaryHoverCardContents(
        [ID_2, ID_1, ID_2, "missing"],
        entries
      ).map((content) => content.entryId)
    ).toEqual([ID_2, ID_1]);
  });
});
