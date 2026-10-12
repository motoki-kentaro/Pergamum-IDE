import { readdirSync, readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t, type Translate, type TranslationKey } from "../../../src/shared/i18n";
import { ConfirmDialog } from "../../../src/renderer/dialog/ConfirmDialog";
import { ImageOverwriteConfirmDialog } from "../../../src/renderer/dialog/ImageOverwriteConfirmDialog";
import {
  confirmDialogDismissesOnBackdropClick,
  type AppConfirmDialogOptions
} from "../../../src/renderer/dialog/appDialogTypes";

// #802: dialog consistency rules (button order, safe initial focus, labels).

const noop = () => undefined;
const clipboardAdapter = { writeText: () => Promise.resolve() };
const translateJa: Translate = (key, values) => t("ja", key, values);
const translateEn: Translate = (key, values) => t("en", key, values);

function renderConfirm(options: AppConfirmDialogOptions): string {
  return renderToStaticMarkup(
    React.createElement(ConfirmDialog, {
      options,
      translate: translateJa,
      clipboardAdapter,
      opener: null,
      onResult: noop
    })
  );
}

function openingTagOf(markup: string, className: string): string {
  const classIndex = markup.indexOf(className);
  const start = markup.lastIndexOf("<button", classIndex);
  return markup.slice(start, markup.indexOf(">", classIndex) + 1);
}

describe("ConfirmDialog safe focus and backdrop (#802)", () => {
  const destructive: AppConfirmDialogOptions = {
    title: "削除",
    message: { kind: "plainText", text: "削除します。" },
    icon: null,
    clipboardText: null,
    tone: "destructive",
    confirmLabel: "削除"
  };

  it("focuses cancel, not the destructive confirm button", () => {
    const markup = renderConfirm(destructive);

    expect(openingTagOf(markup, "appDialogButton-cancel")).toContain("autofocus");
    expect(openingTagOf(markup, "appDialogButton-confirm")).not.toContain(
      "autofocus"
    );
  });

  it("focuses confirm for a non-destructive dialog", () => {
    const markup = renderConfirm({ ...destructive, tone: "default" });

    expect(openingTagOf(markup, "appDialogButton-confirm")).toContain("autofocus");
  });

  it("ignores backdrop clicks for destructive dialogs unless asked otherwise", () => {
    expect(confirmDialogDismissesOnBackdropClick(destructive)).toBe(false);
    expect(
      confirmDialogDismissesOnBackdropClick({
        ...destructive,
        dismissOnBackdropClick: true
      })
    ).toBe(true);
    expect(
      confirmDialogDismissesOnBackdropClick({ ...destructive, tone: "default" })
    ).toBe(true);
  });
});

describe("ImageOverwriteConfirmDialog (#802)", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ImageOverwriteConfirmDialog, {
      isOpen: true,
      fileNames: ["a.png"],
      translate: translateJa,
      onConfirm: noop,
      onCancel: noop
    })
  );

  it("focuses cancel so an initial Enter never overwrites", () => {
    expect(openingTagOf(markup, "appDialogButton-cancel")).toContain("autofocus");
    expect(openingTagOf(markup, "appDialogButton-choice-destructive")).not.toContain(
      "autofocus"
    );
  });

  it("renders cancel before the destructive overwrite button", () => {
    expect(markup.indexOf("appDialogButton-cancel")).toBeLessThan(
      markup.indexOf("appDialogButton-choice-destructive")
    );
  });
});

describe("shared dialog rules via source (#802)", () => {
  const read = (path: string): string => readFileSync(path, "utf8");

  it("does not use the undefined appDialogButton-primary class", () => {
    for (const path of [
      "src/renderer/dialog/FontPickerDialog.tsx",
      "src/renderer/dialog/PdfPageNumberSettingsDialog.tsx"
    ]) {
      expect(read(path)).not.toContain("appDialogButton-primary");
    }
  });

  it("styles the confirm and destructive buttons", () => {
    const css = read("src/renderer/styles.css");

    expect(css).toContain(".appDialogButton-confirm {");
    expect(css).toContain(".appDialogButton-choice-destructive {");
  });

  it("keeps no platform-dependent action order in Pergamum-owned dialogs", () => {
    for (const path of [
      "src/renderer/dialog/appDialogTypes.ts",
      "src/renderer/dialog/ConfirmDialog.tsx",
      "src/renderer/dialog/SaveDestinationDialog.tsx",
      "src/renderer/dialog/JapaneseMachineCheckDialog.tsx"
    ]) {
      expect(read(path)).not.toContain("getDialogActionOrder");
    }
  });

  it("uses Cancel for the first glossary export wizard step", () => {
    expect(read("src/renderer/dialog/GlossaryExportWizardDialog.tsx")).toMatch(
      /glossaryExportWizardCancelButton[^]*?common\.cancel/
    );
  });

  it("gives warning icons the warning tooltip, not the dialog title", () => {
    const app = read("src/renderer/App.tsx");

    expect(app).not.toContain(
      'tooltip: translate("export.confirmation.reloadDiscard.title")'
    );
    expect(app).not.toContain(
      'tooltip: translate("documentMap.export.overwriteConfirm.title")'
    );
  });

  it("opens the wizard overwrite confirmation with cancel focused", () => {
    const source = read("src/renderer/dialog/ExportConfirmationDialog.tsx");

    expect(source).toMatch(/autoFocus\s+data-export-overwrite-cancel/);
  });
});

describe("dialog button labels (#802)", () => {
  const buttonKeys: TranslationKey[] = [
    "dialog.unsavedChanges.saveAndClose",
    "dialog.unsavedChanges.discardAndClose",
    "dialog.unsavedChanges.discardAndQuit",
    "dialog.unsavedChanges.saveAllAndClose",
    "dialog.unsavedChanges.saveAllAndQuit",
    "dialog.projectSwitchUnsaved.discardAndContinue",
    "dialog.settingsRestartRequired.confirm",
    "dialog.recovery.decideLater",
    "dialog.recovery.discardSelected",
    "dialog.recovery.discardAll",
    "dialog.recovery.restoreSelected",
    "dialog.recoveryGlossaryConflict.confirm",
    "dialog.createProjectConflict.overwriteAndCreate",
    "dialog.readOnlyProjectOpen.openReadOnly",
    "dialog.readOnlyProjectSaveAsInsideRoot.save",
    "export.confirmation.reloadDiscard.confirm",
    "keyboardShortcuts.resetAll.confirm",
    "dialog.sessionPersistenceSuspended.openSessionsFolder"
  ];

  it("writes English dialog button labels in sentence case", () => {
    for (const key of buttonKeys) {
      expect(translateEn(key), key).not.toMatch(/\s[A-Z][a-z]/);
    }
  });

  it("pairs the quit and close discard labels", () => {
    expect(translateJa("dialog.unsavedChanges.discardAndClose")).toBe(
      "変更を破棄して閉じる"
    );
    expect(translateJa("dialog.unsavedChanges.discardAndQuit")).toBe(
      "変更を破棄して終了"
    );
    expect(translateEn("dialog.unsavedChanges.discardAndQuit")).toBe(
      "Discard changes and quit"
    );
  });

  it("does not repeat the dialog question in the delete and overwrite messages", () => {
    expect(translateJa("explorer.delete.dialog.title")).toBe("項目を削除しますか？");
    expect(translateEn("explorer.delete.dialog.title")).toBe("Delete items?");
    for (const key of [
      "glossaryExport.overwriteConfirm.message",
      "documentMap.export.overwriteConfirm.message",
      "export.confirmation.reloadDiscard.message"
    ] as const) {
      expect(translateJa(key, { count: 2 }), key).not.toMatch(/[？?]/);
      expect(translateEn(key, { count: 2 }), key).not.toMatch(/\?/);
    }
  });

  it("uses the same Cancel and OK vocabulary in both languages", () => {
    expect(translateJa("common.cancel")).toBe("キャンセル");
    expect(translateEn("common.cancel")).toBe("Cancel");
    expect(translateJa("common.ok")).toBe("OK");
    expect(translateEn("common.ok")).toBe("OK");
  });
});

describe("dialog titles (#802)", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      return entry.isDirectory()
        ? sourceFiles(path)
        : path.endsWith(".tsx")
          ? [path]
          : [];
    });
  }

  it("gives every InfoDialog usage a title", () => {
    for (const path of sourceFiles("src/renderer")) {
      if (path.endsWith("dialog/InfoDialog.tsx")) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/<InfoDialog\b([^]*?)\n\s*>/g)) {
        expect(match[1], path).toMatch(/\btitle=/);
      }
    }
  });

  it("renders a heading for the wizard's nested overwrite confirmation", () => {
    const source = readFileSync(
      "src/renderer/dialog/ExportConfirmationDialog.tsx",
      "utf8"
    );

    expect(source).toContain("export.wizard.overwriteConfirmTitle");
    expect(source).toContain("appDialog appDialog-warning exportOverwriteConfirmContent");
    expect(t("en", "export.wizard.overwriteConfirmTitle")).toBe(
      "Overwrite the file?"
    );
  });
});
