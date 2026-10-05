import type { JSX } from "react";
import type { Translate } from "../shared/i18n";
import type { GlossaryOccurrenceTrackingState } from "./glossaryOccurrenceTracking";

interface GlossaryOccurrencesPanelProps {
  session: GlossaryOccurrenceTrackingState;
  translate: Translate;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  onOpenEntry: () => void;
  onCloseTracking: () => void;
}

export function GlossaryOccurrencesPanel({
  session,
  translate,
  onNavigatePrevious,
  onNavigateNext,
  onOpenEntry,
  onCloseTracking
}: GlossaryOccurrencesPanelProps): JSX.Element {
  if (session.kind !== "active") {
    return (
      <p className="utilityWindowEmpty">
        {translate("utilityWindow.occurrences.empty")}
      </p>
    );
  }

  return (
    <div className="glossaryOccurrencesPanel">
      <div className="glossaryOccurrencesPanelHeader">
        <h2 className="glossaryOccurrencesPanelTitle">
          {translate("utilityWindow.occurrences.title", {
            name: session.entryLabel
          })}
        </h2>
        <span className="glossaryOccurrencesPanelPosition">
          {translate("utilityWindow.occurrences.position", {
            current: session.currentIndex + 1,
            total: session.ranges.length
          })}
        </span>
      </div>

      <div className="glossaryOccurrencesPanelActions">
        <button type="button" onClick={onNavigatePrevious}>
          {translate("utilityWindow.occurrences.previous")}
        </button>
        <button type="button" onClick={onNavigateNext}>
          {translate("utilityWindow.occurrences.next")}
        </button>
      </div>

      <div className="glossaryOccurrencesPanelActions">
        <button type="button" onClick={onOpenEntry}>
          {translate("utilityWindow.occurrences.openEntry")}
        </button>
        <button type="button" onClick={onCloseTracking}>
          {translate("utilityWindow.occurrences.closeTracking")}
        </button>
      </div>
    </div>
  );
}
