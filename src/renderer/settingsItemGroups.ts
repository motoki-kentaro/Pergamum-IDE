import type { SettingKey } from "../shared/settingsCatalog";
import type { SettingCatalogItem } from "../shared/settingsUiCatalog";
import type { TranslationKey } from "../shared/i18n";

/**
 * #721: Editor-category items that Application Settings folds into default-
 * collapsed groups. Purely a presentation concern — SettingKeys, catalog
 * order and persistence are untouched.
 */
export interface SettingsItemGroup {
  readonly id: string;
  readonly titleKey: TranslationKey;
  readonly keys: ReadonlySet<SettingKey>;
}

export const editorSettingsItemGroups: readonly SettingsItemGroup[] = [
  {
    id: "nonPrintingCharacters",
    titleKey: "settings.editor.group.nonPrintingCharacters.label",
    keys: new Set<SettingKey>([
      "editor.whitespace.renderIdeographicSpace",
      "editor.whitespace.renderAsciiSpace",
      "editor.whitespace.renderTab",
      "editor.whitespace.renderOtherUnicodeSpace"
    ])
  },
  {
    id: "characterCountExclusions",
    titleKey: "settings.editor.group.characterCountExclusions.label",
    keys: new Set<SettingKey>([
      "editor.characterCount.exclude.whitespace",
      "editor.characterCount.exclude.lineBreaks",
      "editor.characterCount.exclude.headings",
      "editor.characterCount.exclude.markdownSyntax",
      "editor.characterCount.exclude.markdownComments"
    ])
  }
];

export type SettingsItemEntry =
  | { readonly kind: "item"; readonly item: SettingCatalogItem }
  | {
      readonly kind: "group";
      readonly group: SettingsItemGroup;
      readonly items: readonly SettingCatalogItem[];
    };

/**
 * Collects each group's items into one entry placed where the group's first
 * item appears; every other item stays a plain entry in its original order.
 */
export function buildSettingsItemEntries(
  items: readonly SettingCatalogItem[],
  groups: readonly SettingsItemGroup[] = editorSettingsItemGroups
): readonly SettingsItemEntry[] {
  const entries: SettingsItemEntry[] = [];
  const groupEntries = new Map<string, SettingCatalogItem[]>();

  for (const item of items) {
    const group = groups.find((candidate) => candidate.keys.has(item.key));
    if (!group) {
      entries.push({ kind: "item", item });
      continue;
    }

    const existing = groupEntries.get(group.id);
    if (existing) {
      existing.push(item);
      continue;
    }

    const groupItems = [item];
    groupEntries.set(group.id, groupItems);
    entries.push({ kind: "group", group, items: groupItems });
  }

  return entries;
}
