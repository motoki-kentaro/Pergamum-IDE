import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../../src/shared/commandRegistry";
import type { SidebarMode } from "../../src/renderer/sidebarMode";
import {
  createWorkspaceCommandTitles,
  registerWorkspaceCommands,
  workspaceCommandIds,
  workspaceFocusCommandIdForMode
} from "../../src/renderer/workspaceCommands";

const executionOptions = { source: "activityBar" } as const;

describe("workspace commands", () => {
  const titles = {
    toggleFiles: "Focus File Explorer",
    toggleFilesDescription: "Show the File Explorer.",
    focusSearch: "Focus Search",
    focusSearchDescription: "Not implemented.",
    focusGlossary: "Focus Glossary",
    focusGlossaryDescription: "Show the Glossary panel.",
    focusDocumentMap: "Focus Document Map",
    focusDocumentMapDescription: "Show the Document Map panel in the left pane.",
    focusDocumentMetrics: "Focus Document Metrics",
    focusDocumentMetricsDescription:
      "Show the Document Metrics panel in the left pane.",
    openApplicationSettings: "Open Application Settings",
    exportApplicationSettingsJson: "Export Application Settings as JSON",
    exportApplicationSettingsJsonDescription: "",
    openKeyboardShortcuts: "Open Keyboard Shortcuts",
    openKeyboardShortcutsDescription: "Open Keyboard Shortcuts",
    openApplicationSettingsDescription: "Open application-wide settings.",
    showResumeHub: "Show Resume Hub",
    showResumeHubDescription: "Show Resume Hub"
  };

  it("registers Workspace focus and settings commands", () => {
    const registry = new CommandRegistry();

    registerWorkspaceCommands(
      registry,
      {
        focusSidebarMode: () => undefined,
        openApplicationSettings: () => undefined,
        exportApplicationSettingsJson: () => undefined,
        openKeyboardShortcuts: () => undefined,
        showResumeHub: () => undefined,
        canShowResumeHub: () => true
      },
      titles
    );

    expect(registry.list().map((command) => command.id)).toEqual([
      workspaceCommandIds.toggleFiles,
      workspaceCommandIds.focusSearch,
      workspaceCommandIds.focusGlossary,
      workspaceCommandIds.focusDocumentMap,
      workspaceCommandIds.focusDocumentMetrics,
      workspaceCommandIds.openApplicationSettings,
      workspaceCommandIds.exportApplicationSettingsJson,
      workspaceCommandIds.openKeyboardShortcuts,
      workspaceCommandIds.showResumeHub
    ]);
  });

  it("registers workspace.applicationSettings.exportJson and runs the shared export action (#721)", async () => {
    const registry = new CommandRegistry();
    const exportApplicationSettingsJson = vi.fn();

    registerWorkspaceCommands(
      registry,
      {
        focusSidebarMode: () => undefined,
        openApplicationSettings: () => undefined,
        exportApplicationSettingsJson,
        openKeyboardShortcuts: () => undefined,
        showResumeHub: () => undefined,
        canShowResumeHub: () => true
      },
      titles
    );

    expect(workspaceCommandIds.exportApplicationSettingsJson).toBe(
      "workspace.applicationSettings.exportJson"
    );
    const command = registry.get(workspaceCommandIds.exportApplicationSettingsJson);
    expect(command?.title).toBe("Export Application Settings as JSON");
    // Always available: no `when` gate.
    expect(command?.when).toBeUndefined();

    await registry.execute(
      workspaceCommandIds.exportApplicationSettingsJson,
      executionOptions
    );
    expect(exportApplicationSettingsJson).toHaveBeenCalledTimes(1);
  });

  it("focuses the requested Sidebar mode through commands", async () => {
    const registry = new CommandRegistry();
    const focusedModes: SidebarMode[] = [];

    registerWorkspaceCommands(
      registry,
      {
        focusSidebarMode: (mode) => {
          focusedModes.push(mode);
        },
        openApplicationSettings: () => undefined,
        exportApplicationSettingsJson: () => undefined,
        openKeyboardShortcuts: () => undefined,
        showResumeHub: () => undefined,
        canShowResumeHub: () => true
      },
      titles
    );

    await registry.execute(workspaceCommandIds.toggleFiles, executionOptions);
    await registry.execute(workspaceCommandIds.focusSearch, executionOptions);
    await registry.execute(workspaceCommandIds.focusGlossary, executionOptions);
    await registry.execute(workspaceCommandIds.focusDocumentMap, executionOptions);
    await registry.execute(
      workspaceCommandIds.focusDocumentMetrics,
      executionOptions
    );

    expect(focusedModes).toEqual([
      "files",
      "search",
      "glossary",
      "documentMap",
      "documentMetrics"
    ]);
  });

  it("opens Application Settings through a command", async () => {
    const registry = new CommandRegistry();
    const openApplicationSettings = vi.fn();

    registerWorkspaceCommands(
      registry,
      {
        focusSidebarMode: () => undefined,
        openApplicationSettings,
        exportApplicationSettingsJson: () => undefined,
        openKeyboardShortcuts: () => undefined,
        showResumeHub: () => undefined,
        canShowResumeHub: () => true
      },
      titles
    );

    await registry.execute(
      workspaceCommandIds.openApplicationSettings,
      executionOptions
    );

    expect(openApplicationSettings).toHaveBeenCalledTimes(1);
  });

  it("shows Resume Hub through a command", async () => {
    const registry = new CommandRegistry();
    registry.setCommandContextProvider(() => ({ "project.isOpen": true }));
    const showResumeHub = vi.fn();

    registerWorkspaceCommands(
      registry,
      {
        focusSidebarMode: () => undefined,
        openApplicationSettings: () => undefined,
        exportApplicationSettingsJson: () => undefined,
        openKeyboardShortcuts: () => undefined,
        showResumeHub,
        canShowResumeHub: () => true
      },
      titles
    );

    await registry.execute(
      workspaceCommandIds.showResumeHub,
      executionOptions
    );

    expect(showResumeHub).toHaveBeenCalledTimes(1);
  });

  it("maps Sidebar modes to stable Workspace Command IDs", () => {
    expect(workspaceFocusCommandIdForMode("files")).toBe(
      workspaceCommandIds.toggleFiles
    );
    expect(workspaceFocusCommandIdForMode("search")).toBe(
      workspaceCommandIds.focusSearch
    );
    expect(workspaceFocusCommandIdForMode("glossary")).toBe(
      workspaceCommandIds.focusGlossary
    );
    expect(workspaceFocusCommandIdForMode("documentMap")).toBe(
      workspaceCommandIds.focusDocumentMap
    );
    expect(workspaceFocusCommandIdForMode("documentMetrics")).toBe(
      workspaceCommandIds.focusDocumentMetrics
    );
  });

  it("creates localized command titles outside the registry", () => {
    const translate = vi.fn((key: string) => `translated:${key}`);

    expect(createWorkspaceCommandTitles(translate)).toEqual({
      toggleFiles: "translated:command.workspace.files.toggle",
      toggleFilesDescription:
        "translated:command.workspace.files.toggle.description",
      focusSearch: "translated:command.workspace.search.focus",
      focusSearchDescription:
        "translated:command.workspace.search.focus.description",
      focusGlossary: "translated:command.workspace.glossary.focus",
      focusGlossaryDescription:
        "translated:command.workspace.glossary.focus.description",
      focusDocumentMap: "translated:command.workspace.documentMap.focus",
      focusDocumentMapDescription:
        "translated:command.workspace.documentMap.focus.description",
      focusDocumentMetrics:
        "translated:command.workspace.documentMetrics.focus",
      focusDocumentMetricsDescription:
        "translated:command.workspace.documentMetrics.focus.description",
      openApplicationSettings:
        "translated:command.workspace.applicationSettings.open",
      openApplicationSettingsDescription:
        "translated:command.workspace.applicationSettings.open.description",
      exportApplicationSettingsJson:
        "translated:command.workspace.applicationSettings.exportJson",
      exportApplicationSettingsJsonDescription:
        "translated:command.workspace.applicationSettings.exportJson.description",
      openKeyboardShortcuts:
        "translated:command.workspace.keyboardShortcuts.open",
      openKeyboardShortcutsDescription:
        "translated:command.workspace.keyboardShortcuts.open.description",
      showResumeHub: "translated:command.workbench.showResumeHub",
      showResumeHubDescription:
        "translated:command.workbench.showResumeHub.description"
    });
  });

  it("keeps Workspace command definitions independent from React and DOM APIs", () => {
    const source = readFileSync("src/renderer/workspaceCommands.ts", "utf8");

    expect(source).not.toContain("from \"react\"");
    expect(source).not.toContain("from 'react'");
    expect(source).not.toContain("window.");
    expect(source).not.toContain("document.");
    expect(source).not.toContain("HTMLElement");
    expect(source).not.toContain("JSX");
  });
});
