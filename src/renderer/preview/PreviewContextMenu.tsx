import type { JSX } from "react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { ContextMenuItemContent } from "../ContextMenuItemContent";
import { clampContextMenuPosition } from "../contextMenuPosition";
import type { PreviewContextMenuCommandId, PreviewContextMenuTargetState } from "./previewContextMenuState";
import type { Translate } from "../../shared/i18n";

export interface PreviewContextMenuItemViewItem {
  readonly commandId: PreviewContextMenuCommandId;
  readonly label: string;
  readonly enabled: boolean;
  readonly shortcut?: string;
}

export interface PreviewContextMenuProps {
  readonly state: PreviewContextMenuTargetState;
  readonly translate: Translate;
  readonly onSelect: (commandId: PreviewContextMenuCommandId) => void;
  readonly onClose: () => void;
}

export function buildPreviewContextMenuItems(
  state: PreviewContextMenuTargetState,
  translate: Translate
): readonly PreviewContextMenuItemViewItem[] {
  const items: PreviewContextMenuItemViewItem[] = [
    {
      commandId: "copyRichText",
      label: translate("previewContextMenu.copyRichText"),
      enabled: state.hasSelection,
      shortcut: "Ctrl+C"
    },
    {
      commandId: "copyPlainText",
      label: translate("previewContextMenu.copyPlainText"),
      enabled: state.hasSelection
    },
    {
      commandId: "selectAll",
      label: translate("previewContextMenu.selectAll"),
      enabled: true,
      shortcut: "Ctrl+A"
    },
    {
      commandId: "copyLinkUrl",
      label: translate("previewContextMenu.copyLinkUrl"),
      enabled: state.linkUrl !== null && state.linkUrl.length > 0
    },
    {
      commandId: "copySvgSource",
      label: translate("previewContextMenu.copySvgSource"),
      enabled: state.svgElement !== null
    },
    {
      commandId: "copySvgPngImage",
      label: translate("previewContextMenu.copySvgPngImage"),
      enabled: state.svgElement !== null
    }
  ];

  if (state.mathElement !== null) {
    items.push({
      commandId: "copyMathML",
      label: translate("previewContextMenu.copyMathML"),
      enabled: true
    });
  }

  return items;
}

/**
 * Renderer-drawn context menu for the Markdown Preview pane (#799).
 * Shares the same text-only presentation, styling, and keyboard navigation
 * as EditContextMenu.
 */
export function PreviewContextMenu({
  state,
  translate,
  onSelect,
  onClose
}: PreviewContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: state.x, y: state.y });

  useLayoutEffect(() => {
    if (!menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    setPosition(
      clampContextMenuPosition({
        clickX: state.x,
        clickY: state.y,
        menuWidth: rect.width,
        menuHeight: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      })
    );
  }, [state.x, state.y]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, []);

  function moveFocus(target: "next" | "previous" | "first" | "last"): void {
    const enabledItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)'
      ) ?? []
    );
    if (enabledItems.length === 0) {
      return;
    }
    const currentIndex = enabledItems.indexOf(
      document.activeElement as HTMLButtonElement
    );
    const lastIndex = enabledItems.length - 1;
    const nextIndex =
      target === "first"
        ? 0
        : target === "last"
          ? lastIndex
          : target === "next"
            ? currentIndex < 0 || currentIndex === lastIndex
              ? 0
              : currentIndex + 1
            : currentIndex <= 0
              ? lastIndex
              : currentIndex - 1;
    enabledItems[nextIndex]?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing) {
      return;
    }
    switch (event.key) {
      case "Escape":
      case "Tab":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case "ArrowDown":
        event.preventDefault();
        moveFocus("next");
        return;
      case "ArrowUp":
        event.preventDefault();
        moveFocus("previous");
        return;
      case "Home":
        event.preventDefault();
        moveFocus("first");
        return;
      case "End":
        event.preventDefault();
        moveFocus("last");
        return;
    }
  }

  const items = buildPreviewContextMenuItems(state, translate);

  return (
    <div
      className="editContextMenuBackdrop"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="editContextMenu"
        role="menu"
        aria-label={translate("previewContextMenu.label")}
        style={
          {
            "--edit-context-menu-x": `${position.x}px`,
            "--edit-context-menu-y": `${position.y}px`
          } as CSSProperties
        }
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.commandId}
            type="button"
            role="menuitem"
            className="editContextMenuItem"
            data-preview-context-command={item.commandId}
            disabled={!item.enabled}
            aria-disabled={!item.enabled}
            onClick={() => onSelect(item.commandId)}
          >
            <ContextMenuItemContent
              label={item.label}
              shortcut={item.shortcut}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
