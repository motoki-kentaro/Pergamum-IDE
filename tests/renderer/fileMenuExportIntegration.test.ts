import { describe, expect, it, vi } from "vitest";
import {
  getApplicationMenuModel,
  type ApplicationMenuCommandItem,
  type ApplicationMenuSeparatorItem
} from "../../src/shared/applicationMenuModel";
import {
  assistCommandIds,
  editorCommandIds,
  isApplicationMenuCommandId
} from "../../src/shared/commandIds";
import { CommandRegistry } from "../../src/shared/commandRegistry";
import { registerAssistCommands } from "../../src/renderer/assistCommands";
import {
  isApplicationMenuCommandDisabled
} from "../../src/renderer/applicationMenuIntegration";
import { projectApplicationMenu } from "../../src/renderer/applicationMenuProjection";
import { t, type Translate } from "../../src/shared/i18n";

describe("File > Export menu integration (#803)", () => {
  it("is present in the File menu across all platforms after Save As in its own separator section", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      const menus = getApplicationMenuModel(platform);
      const fileMenu = menus.find(
        (menu) => "key" in menu.label && menu.label.key === "menu.file"
      );
      expect(fileMenu).toBeDefined();

      const items = fileMenu!.items;
      const exportIndex = items.findIndex(
        (item) =>
          item.type === "command" &&
          item.commandId === assistCommandIds.openExportDialog
      );
      expect(exportIndex).toBeGreaterThan(-1);

      const exportItem = items[exportIndex] as ApplicationMenuCommandItem;
      expect(exportItem.label).toEqual({ key: "menu.export" });
      expect(exportItem.nativeAccelerator).toBeUndefined();
      expect(exportItem.shortcutDisplay).toBeUndefined();

      // Isolated in its own separator section: preceded and succeeded by separators
      const prevItem = items[exportIndex - 1];
      const nextItem = items[exportIndex + 1];
      expect(prevItem.type).toBe("separator");
      expect(nextItem.type).toBe("separator");

      // Save As precedes the section
      const saveAsIndex = items.findIndex(
        (item) =>
          item.type === "command" &&
          item.commandId === editorCommandIds.saveAs
      );
      expect(saveAsIndex).toBe(exportIndex - 2);
    }
  });

  it("is an allowlisted application menu command id", () => {
    expect(isApplicationMenuCommandId(assistCommandIds.openExportDialog)).toBe(
      true
    );
  });

  it("is localized in ja and en", () => {
    expect(t("ja", "menu.export")).toBe("エクスポート...");
    expect(t("en", "menu.export")).toBe("Export...");
  });

  it("is disabled when no project is open and enabled when a project is open", () => {
    const registry = new CommandRegistry();
    registerAssistCommands(
      registry,
      {
        showLineEndingDistribution: () => undefined,
        insertParagraphIndent: () => undefined,
        removeParagraphIndent: () => undefined,
        openExportDialog: () => undefined
      },
      {
        showLineEndingDistribution: "",
        showLineEndingDistributionDescription: "",
        insertParagraphIndent: "",
        insertParagraphIndentDescription: "",
        removeParagraphIndent: "",
        removeParagraphIndentDescription: "",
        openExportDialog: "Export...",
        openExportDialogDescription: ""
      }
    );

    expect(
      isApplicationMenuCommandDisabled(
        registry,
        { "project.isOpen": false } as never,
        assistCommandIds.openExportDialog
      )
    ).toBe(true);

    expect(
      isApplicationMenuCommandDisabled(
        registry,
        { "project.isOpen": true } as never,
        assistCommandIds.openExportDialog
      )
    ).toBe(false);
  });

  it("projects to Renderer menu without shortcut label and follows disabled state", () => {
    const translate: Translate = (key, values) => t("en", key, values);
    const menus = projectApplicationMenu("windows", {
      translate,
      isDisabled: (commandId) => commandId === assistCommandIds.openExportDialog
    });

    const fileMenu = menus.find((menu) => menu.label === "File")!;
    const exportEntry = fileMenu.items.find(
      (entry) => entry.kind === "item" && entry.label === "Export..."
    );

    expect(exportEntry).toBeDefined();
    if (exportEntry?.kind === "item") {
      expect(exportEntry.disabled).toBe(true);
      expect(exportEntry.shortcutLabel).toBeUndefined();
    }
  });

  it("dispatches with undefined target (implicit projectRoot) when invoked from menu", async () => {
    const registry = new CommandRegistry();
    const openExportDialog = vi.fn();

    registerAssistCommands(
      registry,
      {
        showLineEndingDistribution: () => undefined,
        insertParagraphIndent: () => undefined,
        removeParagraphIndent: () => undefined,
        openExportDialog
      },
      {
        showLineEndingDistribution: "",
        showLineEndingDistributionDescription: "",
        insertParagraphIndent: "",
        insertParagraphIndentDescription: "",
        removeParagraphIndent: "",
        removeParagraphIndentDescription: "",
        openExportDialog: "Export...",
        openExportDialogDescription: ""
      }
    );

    registry.setCommandContextProvider(() => ({ "project.isOpen": true } as never));

    await registry.execute(
      assistCommandIds.openExportDialog,
      { source: "applicationMenu" as never },
      undefined
    );

    expect(openExportDialog).toHaveBeenCalledWith(undefined);
  });
});
