import { useState, type ReactNode, type JSX } from "react";
import chevronDownIcon from "../../../assets/icons/codicons/general/chevron-down.svg?raw";
import chevronRightIcon from "../../../assets/icons/codicons/general/chevron-right.svg?raw";

interface SettingsCollapsibleGroupProps {
  /** Stable id used to link the heading button to its body region. */
  readonly groupId: string;
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * #721: a light, default-collapsed heading that folds a few related settings.
 * The expanded flag is local UI state only — never persisted, so it resets to
 * collapsed whenever the group remounts (e.g. leaving and re-entering the
 * category). Each group is independent (no accordion behaviour).
 */
export function SettingsCollapsibleGroup({
  groupId,
  title,
  children
}: SettingsCollapsibleGroupProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bodyId = `settingsGroupBody-${groupId}`;

  return (
    <div className="settingsCollapsibleGroup" data-expanded={expanded}>
      <button
        type="button"
        className="settingsCollapsibleGroupHeader"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span
          className="settingsCollapsibleGroupChevron"
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html: expanded ? chevronDownIcon : chevronRightIcon
          }}
        />
        <span className="settingsCollapsibleGroupTitle">{title}</span>
      </button>
      {expanded ? (
        <div id={bodyId} className="settingsCollapsibleGroupBody">
          {children}
        </div>
      ) : null}
    </div>
  );
}
