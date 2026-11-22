# 0017 — Workspace search

- **Status:** Accepted (user approval, 2026-11-22)
- **Date:** 2026-11-22
- **Scope:** Find any task or project in the current workspace from one search box
- **Builds on:** [0003](0003-projects-and-tasks.md) (project access), [0013](0013-my-tasks.md) (workspace-wide lists)

## 1. Outcome

A **Search** button at the top of the sidebar, and **Ctrl+K / ⌘K** anywhere in a workspace, open a search dialog. It finds tasks and projects the caller can open, and Enter opens the highlighted result. SPEC R4 held this slot back until search existed.

The List view's own search (`GET /projects/:id/tasks?q=`) stays as it is, scoped to one project.

## 2. API

`GET /api/v1/workspaces/:id/search?q=…` returns `{ tasks: SearchTask[], projects: SearchProject[], hasMoreTasks }`.

- **Access:** the same rule as My tasks (0013) and project access (0003). Members see the projects they belong to; Owners and Admins see every project in the workspace. A non-member gets the same 404 as a missing workspace. Deleted tasks never appear.
- **Query:** trimmed, at most 100 characters. An empty query returns empty lists.
  - `DEV-12`: task 12 of project DEV first, and also text containing "DEV-12".
  - `#12`: task number 12 in any project, only.
  - `12`: task number 12 in any project, or text containing "12".
  - Anything else: task titles and descriptions, and project names and keys.
  - `%` and `_` match themselves.
- **Task order:** the exact key, then tasks in projects that aren't archived, then number or title matches before description-only matches, then open before Done, then most recently updated. At most **20**; `hasMoreTasks` says when there were more.
- **Projects:** name or key matches, the exact key first and archived projects last. At most **5**. Archived projects are included and labelled.
- **Results carry only what the dialog shows:** key, title, status, priority and the project (id, key, name, status). No descriptions, so a long description never travels with a result.
- **Implementation:** `ILIKE` with escaped wildcards, as the List search does. No index or migration: fine at current data sizes. If search gets slow, add a `pg_trgm` index then.

## 3. Website

- **Entry points:** the sidebar's Search button (with a ⌘K or Ctrl K hint, hidden on touch screens) and a search icon in the phone top bar. The shortcut works on any page inside a workspace.
- **Dialog:** a native modal `<dialog>`, full-screen on phones. The input is a combobox over one listbox: **Tasks** then **Projects**. ↑/↓ move and wrap, Enter opens, Esc or Cancel closes, and focus returns to the opener.
- **Searching:** 200 ms after typing pauses. The previous results stay visible, with a spinner, until the new ones arrive.
- **Rows:** a task shows its key, title, project and status pill (never color alone). A project shows its name and key, with an "Archived" badge when archived.
- **Opening:** a task opens its task page (`/projects/:id/tasks/:taskId`), like My tasks; a project opens its board.
- **Messages:** a hint before typing, "No results for …", a failure message, and "Showing the first 20 tasks" when there are more.

## 4. Not included

Chat messages, comments and pull request titles; filters inside the dialog; recent searches. Each can be added later.

## 5. Tests

- **API (e2e):** members only find their projects' tasks, Admins find every project, outsiders get 404; the exact key ranks first; `#n`; title before description-only and open before Done; deleted tasks excluded; `%` literal; archived projects last; the 20-task cap and `hasMoreTasks`.
- **Validators:** query parsing.
- **Website:** result order and links, ↑/↓ wrapping, and the encoded search path.
