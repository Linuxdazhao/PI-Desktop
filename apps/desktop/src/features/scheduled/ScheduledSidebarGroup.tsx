import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, cx } from "../../components/ui";
import { IconChevronDown, IconClock } from "../../components/icons";
import { ProjectRunBadge, ProjectRunRail } from "../../components/ProjectRunIndicator";
import { loadScheduledSidebarCollapsed, saveScheduledSidebarCollapsed } from "../../lib/sidebar-preferences";
import { resolveSidebarRunningAffordances, summarizeProjectRuns } from "../../lib/sidebar-project-runs";
import { useAppStore } from "../../stores/app-store";
import { latestRunByTask } from "./scheduled-runs";
import { useSidebarScheduledTasks } from "./use-sidebar-scheduled-tasks";

export function ScheduledSidebarGroup() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const pendingPermissions = useAppStore((s) => s.pendingPermissions);
  const openTask = useAppStore((s) => s.openScheduledTask);
  const { tasks, runs, loaded, error, refresh } = useSidebarScheduledTasks();
  const [collapsed, setCollapsed] = useState(loadScheduledSidebarCollapsed);
  const affordances = resolveSidebarRunningAffordances(settings);
  const latestRuns = latestRunByTask(runs);
  const liveSessions = tasks.flatMap((task) => {
    const run = latestRuns.get(task.id);
    return run?.status === "running" ? [{ id: run.sessionId ?? run.id }] : [];
  });
  const running = Object.fromEntries(liveSessions.map(({ id }) => [id, true]));
  const summary = summarizeProjectRuns(liveSessions, running, pendingPermissions);
  const showRail = affordances.rail && summary.running + summary.waiting > 0;

  return (
    <section
      className={cx("sidebar-session-group project-group", showRail && "has-run-rail", collapsed && "is-collapsed")}
      data-sidebar-scheduled-group="tasks"
      aria-labelledby="sidebar-scheduled-label"
      onContextMenu={(event) => event.stopPropagation()}
    >
      {showRail && <ProjectRunRail summary={summary} />}
      <div className="sidebar-session-group-header">
        <button
          type="button"
          id="sidebar-scheduled-label"
          className="sidebar-session-group-title"
          aria-expanded={!collapsed}
          aria-controls="sidebar-scheduled-tasks"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            saveScheduledSidebarCollapsed(next);
          }}
        >
          <IconChevronDown size={13} className={cx("sidebar-disclosure-icon", collapsed && "collapsed")} aria-hidden />
          <IconClock size={13} aria-hidden />
          <span>{t("scheduled.title")}</span>
          {affordances.badge && <ProjectRunBadge summary={summary} />}
        </button>
      </div>
      <div
        id="sidebar-scheduled-tasks"
        className={cx("sidebar-session-group-body project", collapsed && "collapsed")}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="sidebar-session-group-clip">
          <div className="sidebar-session-group-list">
            {error && (
              <div className="sidebar-session-empty" role="alert">
                <span>{error}</span>
                <Button size="sm" variant="ghost" onClick={() => void refresh()}>{t("scheduled.retry")}</Button>
              </div>
            )}
            {!loaded && !error && <div className="sidebar-session-empty" role="status">{t("common.loading")}</div>}
            {loaded && tasks.length === 0 && <div className="sidebar-session-empty">{t("scheduled.emptyTitle")}</div>}
            {tasks.map((task) => {
              const run = latestRuns.get(task.id);
              const rowSummary = summarizeProjectRuns(
                run?.status === "running" ? [{ id: run.sessionId ?? run.id }] : [],
                running,
                pendingPermissions,
              );
              return (
                <div className="thread-item" key={task.id} data-sidebar-scheduled-task={task.id}>
                  <button type="button" className="thread-item-main" onClick={() => openTask(task.id)}>
                    <span className="thread-item-title">{task.title}</span>
                    {!task.enabled && <span className="thread-item-source">{t("scheduled.disabled")}</span>}
                    {affordances.badge && <ProjectRunBadge summary={rowSummary} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
