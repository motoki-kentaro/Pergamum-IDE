import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActivityBar } from "../../src/renderer/ActivityBar";
import {
  createProjectSettingsCommands,
  createProjectSettingsCommandTitles,
  projectSettingsCommandIds,
  registerProjectSettingsCommands
} from "../../src/renderer/projectSettingsCommands";
import { ProjectSettingsPanel } from "../../src/renderer/ProjectSettingsPanel";
import {
  reorderWorkspaceTabOrder,
  specialWorkspaceTabId,
  syncWorkspaceTabOrder,
  workspaceTabKey,
  workspaceTabs,
  type SpecialWorkspaceTab,
  type WorkspaceTabId
} from "../../src/renderer/workspaceTabs";
import { CommandRegistry } from "../../src/shared/commandRegistry";
import { evaluateCommandEnablement } from "../../src/shared/commandEnablement";
import type { Translate } from "../../src/shared/i18n";
import { enTranslations } from "../../src/shared/i18n/en";
import { jaTranslations } from "../../src/shared/i18n/ja";

const appSource = () => readFileSync("src/renderer/App.tsx", "utf8");
const translate: Translate = (key) => jaTranslations[key] ?? enTranslations[key] ?? key;

describe("Project Settings special tab identity & workspace tabs (#396)", () => {
  it("defines projectSettings as a special workspace tab with stable key", () => {
    const tabId = specialWorkspaceTabId("projectSettings");

    expect(tabId).toEqual({ kind: "special", id: "projectSettings" });
    expect(workspaceTabKey(tabId)).toBe("special:projectSettings");
  });

  it("participates in workspace tabs and tab ordering (#398)", () => {
    const specialTabs: readonly SpecialWorkspaceTab[] = [
      { kind: "special", id: "settings", title: "設定" },
      { kind: "special", id: "projectSettings", title: "プロジェクト設定" }
    ];
    const tabs = workspaceTabs([], specialTabs);

    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toEqual({
      kind: "special",
      id: "projectSettings",
      title: "プロジェクト設定"
    });

    const initialOrder: readonly WorkspaceTabId[] = [
      specialWorkspaceTabId("settings"),
      specialWorkspaceTabId("projectSettings")
    ];

    const synced = syncWorkspaceTabOrder([], [], specialTabs);
    expect(synced).toEqual(initialOrder);

    // Reordering special tabs with D&D
    const reordered = reorderWorkspaceTabOrder(
      initialOrder,
      specialWorkspaceTabId("projectSettings"),
      0
    );
    expect(reordered).toEqual([
      specialWorkspaceTabId("projectSettings"),
      specialWorkspaceTabId("settings")
    ]);
  });
});

describe("Activity Bar Project Settings entry (#396)", () => {
  function markup(props: Partial<Parameters<typeof ActivityBar>[0]>): string {
    return renderToStaticMarkup(
      React.createElement(ActivityBar, {
        activeMode: "files",
        isApplicationSettingsActive: false,
        translate,
        onSelectMode: () => undefined,
        onOpenApplicationSettings: () => undefined,
        ...props
      })
    );
  }

  it("does not render the Project Settings button when no project is open", () => {
    const rendered = markup({ isProjectOpen: false });

    expect(rendered).not.toContain(jaTranslations["activity.projectSettings"]);
    expect(rendered).toContain(jaTranslations["activity.applicationSettings"]);
  });

  it("renders the Project Settings button immediately above Application Settings when a project is open", () => {
    const rendered = markup({ isProjectOpen: true });

    const projectSettingsLabel = jaTranslations["activity.projectSettings"];
    const appSettingsLabel = jaTranslations["activity.applicationSettings"];

    const projectIndex = rendered.indexOf(projectSettingsLabel);
    const appIndex = rendered.indexOf(appSettingsLabel);

    expect(projectIndex).toBeGreaterThan(-1);
    expect(appIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeLessThan(appIndex);
  });

  it("reflects active state on the Project Settings button", () => {
    const inactive = markup({ isProjectOpen: true, isProjectSettingsActive: false });
    const active = markup({ isProjectOpen: true, isProjectSettingsActive: true });

    const label = jaTranslations["activity.projectSettings"];
    expect(inactive).toContain(`aria-label="${label}" aria-pressed="false"`);
    expect(active).toContain(`aria-label="${label}" aria-pressed="true"`);
    expect(active).toMatch(/class="[^"]*activityBarItem isActive[^"]*"/);
  });

  it("renders Project Settings button even for read-only projects as long as isProjectOpen is true", () => {
    const rendered = markup({ isProjectOpen: true });

    expect(rendered).toContain(jaTranslations["activity.projectSettings"]);
  });
});

describe("Project Settings command registration & gating (#396)", () => {
  it("registers project.settings.open gated with when: { key: 'project.isOpen' }", () => {
    const registry = new CommandRegistry();
    let opened = false;

    const titles = createProjectSettingsCommandTitles(translate);
    registerProjectSettingsCommands(
      registry,
      { openProjectSettings: () => { opened = true; }, exportProjectSettingsJson: () => undefined },
      titles
    );

    const command = registry.get(projectSettingsCommandIds.open);
    expect(command).toBeDefined();
    expect(command?.id).toBe("project.settings.open");
    expect(command?.title).toBe(jaTranslations["command.project.settings.open"]);
    expect(command?.description).toBe(
      jaTranslations["command.project.settings.open.description"]
    );
    expect(command?.when).toEqual({ key: "project.isOpen" });

    // Enablement evaluation
    expect(
      evaluateCommandEnablement(command?.when, {
        "project.isOpen": false
      })
    ).toBe(false);

    expect(
      evaluateCommandEnablement(command?.when, {
        "project.isOpen": true
      })
    ).toBe(true);

    command?.execute();
    expect(opened).toBe(true);
  });
});

describe("Project Settings export command (#721)", () => {
  it("registers project.settings.exportJson gated by project.isOpen and runs the shared export action", async () => {
    const registry = new CommandRegistry();
    const exportProjectSettingsJson = vi.fn();
    registerProjectSettingsCommands(
      registry,
      { openProjectSettings: () => undefined, exportProjectSettingsJson },
      createProjectSettingsCommandTitles(translate)
    );

    const command = registry.get(projectSettingsCommandIds.exportJson);
    expect(command?.id).toBe("project.settings.exportJson");
    expect(command?.title).toBe(
      jaTranslations["command.project.settings.exportJson"]
    );
    expect(command?.description).toBe(
      jaTranslations["command.project.settings.exportJson.description"]
    );
    expect(command?.when).toEqual({ key: "project.isOpen" });
    expect(
      evaluateCommandEnablement(command?.when, { "project.isOpen": false })
    ).toBe(false);

    registry.setCommandContextProvider(() => ({ "project.isOpen": true }));
    await registry.execute(projectSettingsCommandIds.exportJson, {
      source: "commandPalette"
    });
    expect(exportProjectSettingsJson).toHaveBeenCalledTimes(1);

    registry.setCommandContextProvider(() => ({ "project.isOpen": false }));
    await expect(
      registry.execute(projectSettingsCommandIds.exportJson, {
        source: "commandPalette"
      })
    ).rejects.toThrow();
    expect(exportProjectSettingsJson).toHaveBeenCalledTimes(1);
  });

  it("App routes both Settings export buttons and both commands through one export handler each", () => {
    const source = appSource();

    expect(source).toContain(
      "exportApplicationSettingsJson: () =>\n          exportApplicationSettingsCommandRef.current()"
    );
    expect(source).toContain(
      "exportProjectSettingsJson: () =>\n          exportProjectSettingsCommandRef.current()"
    );
    expect(source).toContain(
      "workspaceCommandIds.exportApplicationSettingsJson,\n                          { source: \"settingsPanel\" }"
    );
    expect(source).toContain("projectSettingsCommandIds.exportJson, {");
    // The panels no longer call the handlers directly.
    expect(source).not.toContain("onExportSettings={handleExportApplicationSettings}");
    expect(source).not.toContain("onExportSettings={handleExportProjectSettings}");
    // Exactly one definition per export implementation.
    expect(source.match(/async function handleExportApplicationSettings\(/g)).toHaveLength(1);
    expect(source.match(/async function handleExportProjectSettings\(/g)).toHaveLength(1);
    expect(source.match(/settings\?\.exportJson/g)).toHaveLength(2);
  });
});

describe("Settings export row command id & theme-aware button (#721)", () => {
  it("shows the command id on the Application and Project export rows", () => {
    const panelSource = readFileSync("src/renderer/SettingsPanel.tsx", "utf8");
    const projectSource = readFileSync(
      "src/renderer/ProjectSettingsPanel.tsx",
      "utf8"
    );

    expect(panelSource).toContain(
      "{workspaceCommandIds.exportApplicationSettingsJson}"
    );
    expect(projectSource).toContain("{projectSettingsCommandIds.exportJson}");
    expect(workspaceCommandIdsText()).toContain(
      "workspace.applicationSettings.exportJson"
    );
  });

  it("styles the export button from theme tokens, not a fixed blue", () => {
    const css = readFileSync("src/renderer/styles.css", "utf8");
    const start = css.indexOf(".settingsExportButton {");
    const end = css.indexOf(".settingsExportButton:disabled");
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("var(--pg-color-accent-interactive)");
    expect(block).toContain("var(--pg-color-accent-foreground)");
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("has JA and EN command titles and descriptions, and keeps the UI export strings", () => {
    for (const key of [
      "command.workspace.applicationSettings.exportJson",
      "command.workspace.applicationSettings.exportJson.description",
      "command.project.settings.exportJson",
      "command.project.settings.exportJson.description"
    ] as const) {
      expect(jaTranslations[key]).toBeTruthy();
      expect(enTranslations[key]).toBeTruthy();
    }
    expect(jaTranslations["command.workspace.applicationSettings.exportJson"]).toBe(
      "アプリケーション設定をJSONとしてエクスポート"
    );
    expect(jaTranslations["command.project.settings.exportJson"]).toBe(
      "プロジェクト設定をJSONとしてエクスポート"
    );
    expect(jaTranslations["settings.export.action.label"]).toBe(
      "設定をJSONとしてエクスポート"
    );
    expect(enTranslations["settings.export.button"]).toBe("Export");
  });
});

function workspaceCommandIdsText(): string {
  return readFileSync("src/shared/commandIds.ts", "utf8");
}

describe("Project Settings panel (#396 Slice 3)", () => {
  it("renders header, description, and structured font list controls", () => {
    const rendered = renderToStaticMarkup(
      React.createElement(ProjectSettingsPanel, {
        translate,
        projectSettings: undefined,
        inheritedFontFamily: "Consolas",
        isReadOnly: false,
        onSaveSettings: async () => undefined
      })
    );

    expect(rendered).toContain('class="settingsPanel projectSettingsPanel"');
    expect(rendered).toContain(
      jaTranslations["settings.workbench.uiFontFamilyList.label"]
    );
    expect(rendered).toContain("fontFamilyListControlGroup");
    expect(rendered).toContain("fontCacheControlRow");
    expect(rendered).toContain(jaTranslations["fontPicker.button.choose"]);
    expect(rendered).not.toContain(
      jaTranslations["settings.editor.fontFamily.label"]
    );
  });
});

describe("App wiring for Project Settings special tab (#396)", () => {
  it("maintains dedicated open-state and active-state in App", () => {
    const source = appSource();

    expect(source).toContain(
      "const [isProjectSettingsTabOpen, setIsProjectSettingsTabOpen] ="
    );
    expect(source).toContain(
      'isProjectSettingsTabOpen && activeSpecialTabId === "projectSettings"'
    );
    expect(source).toContain('specialWorkspaceTabId("projectSettings")');
  });

  it("protects zero-document fallback from stealing focus when Project Settings tab is active", () => {
    const source = appSource();

    expect(source).toContain("!isProjectSettingsTabActive");
    expect(source).toContain(
      "(activeSpecialTabId === \"settings\" || !hasOpenDocumentTab)"
    );
  });

  it("registers project settings commands in App and wires Activity Bar click", () => {
    const source = appSource();

    expect(source).toContain("registerProjectSettingsCommands(");
    expect(source).toContain("openProjectSettingsTab();");
    expect(source).toContain("onOpenProjectSettings={() =>");
    expect(source).toContain("executeUiCommand(projectSettingsCommandIds.open");
  });

  it("resets project settings tab on project switch, project close, and cold start", () => {
    const source = appSource();

    const switchIndex = source.indexOf("setIsGlossaryTagManagerTabOpen(false);");
    expect(switchIndex).toBeGreaterThan(-1);

    // Count occurrences of setIsProjectSettingsTabOpen(false)
    const resetMatches = source.match(/setIsProjectSettingsTabOpen\(false\)/g);
    // Should occur at closeSpecialTab, project switch, project close, and cold start (at least 4)
    expect(resetMatches?.length).toBeGreaterThanOrEqual(4);

    // Verify projectSettings is cleared in setActiveSpecialTabId on lifecycle transitions
    expect(source).toMatch(
      /current === "glossaryTagManager" \|\|\s*current === "glossaryEntryManager" \|\|\s*current === "projectSettings"/
    );
  });

  it("closes active Project Settings tab without dirty confirmation in closeEditorWithConfirmation", () => {
    const source = appSource();
    const closeFunctionIndex = source.indexOf(
      "async function closeEditorWithConfirmation"
    );
    const nextFunctionIndex = source.indexOf(
      "runEditorCloseFlow",
      closeFunctionIndex
    );
    const closeBlock = source.slice(closeFunctionIndex, nextFunctionIndex);

    expect(closeBlock).toContain("if (!editorId && isProjectSettingsTabActive) {");
    expect(closeBlock).toContain('closeSpecialTab("projectSettings");');
  });

  it("renders ProjectSettingsPanel inside the editor tab area", () => {
    const source = appSource();
    const bodyIndex = source.indexOf(
      '<section className="editorAreaBody" ref={editorAreaBodyRef}>'
    );
    const statusBarIndex = source.indexOf('<footer className="statusBar">');
    const editorAreaBodyBlock = source.slice(bodyIndex, statusBarIndex);

    expect(editorAreaBodyBlock).toContain("isProjectSettingsTabActive ? (");
    expect(editorAreaBodyBlock).toContain("<ProjectSettingsPanel");
    expect(editorAreaBodyBlock).toContain("projectSettings={project?.config?.settings}");
  });
});
