# ADR: Optional scheduled-task shortcuts in the sidebar

- Status: Implemented candidate
- Date: 2026-10-29
- Related issue: #1962

## Context

The Scheduled workspace owns automation transcripts so recurring executions do
not fill ordinary conversation lists. Some users also want a direct sidebar
entry for a particular task instead of opening the task index first.

## Decision

Add `AppSettings.sidebarScheduledTasks` as an optional, default-off display
preference. An enabled sidebar shows one shortcut per task in a separate group;
activation selects the existing task detail and run history. It never creates,
enables or executes a task and preserves transcript ownership and exclusion
from conversation search.

Keep task definitions and results in Rust. The renderer reads the existing task
and newest-run queries while shortcuts are enabled, using the Scheduled page's
ten-second cadence plus focus refresh. Stale reads cannot replace newer state
or restore a disabled group. The existing running-indicator settings gate the
count and rail. Save folding under `pi.desktop.sidebarScheduledTasksCollapsed`,
outside path-keyed project preferences.

Reuse the sidebar search from #1955, preserving its author and source commit.
The display preference also controls task-name participation in sidebar search.
Use the same trimmed, case-insensitive substring match as other sidebar entries
and filter loaded tasks without restarting the polling lifecycle. Search
temporarily expands matching tasks without writing fold preferences; clearing
it restores the saved state. A disabled group contributes no search results.

## Consequences

Existing installs retain the current navigation by default. Enabling shortcuts
adds read-only polling and per-task navigation; failures expose Retry. The
boolean travels through existing settings persistence without a database or
protocol migration. Old clients ignore it.

## Alternatives

Reintroducing each run as a conversation would undo the ownership decision and
grow the sidebar with every execution. The default-off task group offers a
shortcut while leaving those records under the owning task.
