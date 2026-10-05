import type { JSX } from "react";
import type { Translate } from "../shared/i18n";
import type { GlossaryHoverCardEntryContent } from "./glossaryHoverCardContent";

interface GlossaryHoverCardProps {
  contents: readonly GlossaryHoverCardEntryContent[];
  translate: Translate;
}

/**
 * #731: representative atom, then the other atoms, then the assigned tags.
 * Empty lines are omitted (no placeholder). Presentational only; positioning
 * lives in GlossaryPreviewDecorator.
 */
export function GlossaryHoverCard({
  contents,
  translate
}: GlossaryHoverCardProps): JSX.Element {
  const separator = translate("preview.glossaryHoverCard.listSeparator");

  return (
    <aside className="glossaryHoverCard" role="tooltip">
      {contents.map((content) => (
        <div className="glossaryHoverCardEntry" key={content.entryId}>
          <div className="glossaryHoverCardTitle">{content.representative}</div>
          {content.otherAtoms.length > 0 ? (
            <div className="glossaryHoverCardAtoms">
              {content.otherAtoms.join(separator)}
            </div>
          ) : null}
          {content.tags.length > 0 ? (
            <div className="glossaryHoverCardTags">
              {translate("preview.glossaryHoverCard.tags", {
                tags: content.tags.join(separator)
              })}
            </div>
          ) : null}
        </div>
      ))}
    </aside>
  );
}
