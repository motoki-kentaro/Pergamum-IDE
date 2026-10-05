import type { JSX } from "react";
import type { RecentProject } from "../shared/api";
import type { Translate } from "../shared/i18n";

interface RecentProjectsPanelProps {
  recentProjects: RecentProject[];
  translate: Translate;
  onOpenProject: (projectFilePath: string) => void;
}

export function RecentProjectsPanel({
  recentProjects,
  translate,
  onOpenProject
}: RecentProjectsPanelProps): JSX.Element {
  return (
    <section className="recentProjectsPanel" aria-label={translate("recent.title")}>
      <div className="recentProjectsHeader">{translate("recent.title")}</div>
      {recentProjects.length === 0 ? (
        <div className="recentProjectsEmpty">{translate("recent.empty")}</div>
      ) : (
        <nav className="recentProjectsList" aria-label={translate("recent.title")}>
          {recentProjects.map((recentProject) => (
            <button
              key={recentProject.projectId}
              type="button"
              className="recentProjectItem"
              title={recentProject.projectFilePath}
              onClick={() => onOpenProject(recentProject.projectFilePath)}
            >
              <span className="recentProjectName">
                {recentProject.projectName}
              </span>
              <span className="recentProjectPath">
                {recentProject.projectFilePath}
              </span>
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}
