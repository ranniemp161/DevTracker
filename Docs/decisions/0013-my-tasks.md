# 0013 - My tasks

- **Status:** Accepted
- **Date:** 2026-11-14
- **Changes scope:** Adds a cross-project view of the caller's own work. SPEC R4 said to add the "My tasks" sidebar entry once the feature exists.

## Purpose

Show what I need to do across a workspace's projects in one place, most urgent first, without opening each project.

## Rules

- **Endpoint:** `GET /api/v1/workspaces/:id/my-tasks` returns `{ tasks: MyTask[], hasMore }`. `MyTask` is a `Task` plus `project: { id, key, name }`.
- **Scope: the current workspace only,** matching the sidebar. A non-member gets the same 404 as for a missing workspace.
- **Which tasks:** assigned to the caller, not deleted, not Done, in projects that aren't archived. Only projects the caller can still access count: their own projects, or every project for workspace Owners and Admins (the same rule as project access, record 0003). Removing someone from a project already unassigns them, and this filter is the second guard.
- **Order:** due date ascending with undated tasks last, then priority (Urgent first), then oldest first.
- **Limit:** 100, with no paging. `hasMore` lets the view say "100+" and point to the projects for the rest, instead of inventing a total.
- **View:** `/workspaces/[id]/my-tasks`. Tasks are grouped as Overdue, Today, Next 7 days, Later and No due date, using the viewer's local calendar date. Each row has the status menu, with the same Undo message as the Board.
- **Live updates:** the view joins the room of each listed project and refreshes on `task.*` events. It also refreshes on the caller's notifications, which is how a new assignment in another project arrives.
- **No mockup exists** for this screen. It follows the List screen's styling (`list.html`) and SPEC tokens.
