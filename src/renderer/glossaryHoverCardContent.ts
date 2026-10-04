import type { GlossaryEntry, GlossaryEntryId } from "../shared/glossary";

/**
 * #731: what the Preview glossary hover card shows for one entry, derived from
 * the current atoms + tags model. Deliberately excludes the Description.
 */
export interface GlossaryHoverCardEntryContent {
  readonly entryId: GlossaryEntryId;
  /** `atoms[0]` — the representative surface. */
  readonly representative: string;
  /** `atoms[1..n]` in registered (`sortOrder`) order; `[]` when none. */
  readonly otherAtoms: readonly string[];
  /** Assigned tag labels in entry assignment order; `[]` when none. */
  readonly tags: readonly string[];
}

export function buildGlossaryHoverCardEntryContent(
  entry: GlossaryEntry
): GlossaryHoverCardEntryContent | null {
  const surfaces = [...entry.atoms]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((atom) => atom.value.trim())
    .filter((value) => value.length > 0);
  const [representative, ...otherAtoms] = surfaces;

  if (representative === undefined) {
    return null;
  }

  return {
    entryId: entry.id,
    representative,
    otherAtoms,
    tags: entry.tags.map((tag) => tag.label)
  };
}

/**
 * Content for every distinct entry a decorated match resolves to, in the
 * match's candidate order. Unknown entry ids (e.g. the glossary refreshed
 * since the decoration pass) are skipped.
 */
export function buildGlossaryHoverCardContents(
  entryIds: readonly GlossaryEntryId[],
  entries: readonly GlossaryEntry[]
): GlossaryHoverCardEntryContent[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<GlossaryEntryId>();
  const contents: GlossaryHoverCardEntryContent[] = [];

  for (const entryId of entryIds) {
    if (seen.has(entryId)) {
      continue;
    }
    seen.add(entryId);
    const entry = byId.get(entryId);
    const content = entry ? buildGlossaryHoverCardEntryContent(entry) : null;
    if (content) {
      contents.push(content);
    }
  }

  return contents;
}
