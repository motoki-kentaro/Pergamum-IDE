import {
  type Command,
  type CommandRegistry
} from "../shared/commandRegistry";
import { projectSettingsCommandIds } from "../shared/commandIds";
import type { Translate } from "../shared/i18n";

export { projectSettingsCommandIds };

export interface ProjectSettingsCommandController {
  openProjectSettings(): void;
  exportProjectSettingsJson(): void | Promise<void>;
}

export interface ProjectSettingsCommandTitles {
  open: string;
  openDescription: string;
  exportJson: string;
  exportJsonDescription: string;
}

type ProjectSettingsCommand = Command<readonly [], void>;

export function createProjectSettingsCommandTitles(
  translate: Translate
): ProjectSettingsCommandTitles {
  return {
    open: translate("command.project.settings.open"),
    openDescription: translate("command.project.settings.open.description"),
    exportJson: translate("command.project.settings.exportJson"),
    exportJsonDescription: translate(
      "command.project.settings.exportJson.description"
    )
  };
}

export function createProjectSettingsCommands(
  controller: ProjectSettingsCommandController,
  titles: ProjectSettingsCommandTitles
): readonly ProjectSettingsCommand[] {
  return [
    {
      id: projectSettingsCommandIds.open,
      title: titles.open,
      description: titles.openDescription,
      when: { key: "project.isOpen" },
      category: "file",
      paletteOrder: 100,
      execute: () => {
        controller.openProjectSettings();
      }
    },
    {
      id: projectSettingsCommandIds.exportJson,
      title: titles.exportJson,
      description: titles.exportJsonDescription,
      when: { key: "project.isOpen" },
      category: "file",
      paletteOrder: 101,
      execute: () => controller.exportProjectSettingsJson()
    }
  ];
}

export function registerProjectSettingsCommands(
  registry: CommandRegistry,
  controller: ProjectSettingsCommandController,
  titles: ProjectSettingsCommandTitles
): void {
  for (const command of createProjectSettingsCommands(controller, titles)) {
    registry.register(command);
  }
}
