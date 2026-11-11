# 0012 - Time entries and estimates

- **Status:** Accepted
- **Date:** 2026-11-11
- **Changes scope:** Second step of the scope opened by record 0011 (architecture §18, "Time tracking and timesheets"). Timesheets and reports stay excluded.

## Purpose and scope

Let the team record how much effort a task took and compare it with what they expected.

- An **estimate** on each task.
- **Time entries** logged by hand against a task.

Not in scope: a running timer, timesheets, per-person or per-project reports, billing rates, approval of entries, totals on board cards or list rows.

## Rules

1. **Minutes everywhere.** Estimates and entries are stored as whole minutes, so estimate and actual compare directly. The UI reads and shows hours and minutes (`1h 30m`, `90m`, `1.5h`; a bare number means hours).
2. **Estimate:** `tasks.estimate_minutes`, nullable, 1 minute to 1,000 hours. It is set on create or through `PATCH /tasks/:id` like any other field, so it follows the explicit Save on task detail. `null` clears it. Changes appear in activity as a normal `task.updated` field change.
3. **Time entry:** minutes (1 to 1,440, one day), the calendar day the work was done (`spent_on`), an optional note (500 characters), and who logged it.
4. **Who can change entries (owner decision, 2026-11-11):** anyone who can edit the task can add, edit or remove **any** entry on it, not only their own. This uses the existing project access rule (record 0003): workspace Owners and Admins, and Members who belong to the project. Everyone else gets 404. Editing an entry does not change who logged it.
5. **Archived projects are read-only:** entries can be read but not added, changed or removed (409 `PROJECT_ARCHIVED`).
6. **Entries are hard-deleted.** Every add, edit and removal is written to the task's activity (`task.time_logged`, `task.time_updated`, `task.time_removed`) with the minutes, which is the audit trail. The note is free text and never goes into activity (record 0004, rule 3).
7. **Logged total:** `Task.loggedMinutes` is the sum of the task's entries, computed on read. No stored total.
8. **Realtime:** each change emits `task.updated` for the task, so open task pages refresh.
9. **No notifications** for time entries.

## Data

Migration `0010_time_entries`: adds `tasks.estimate_minutes` and the `time_entries` table. It only adds a nullable column and a new table, so code from before the migration keeps working against the migrated database.

## API

- `GET /tasks/:id/time-entries` → `{ entries }`, most recent work day first
- `POST /tasks/:id/time-entries` → `{ entry }`
- `PATCH /time-entries/:id` → `{ entry }`
- `DELETE /time-entries/:id` → 204
- `Task` gains `estimateMinutes` and `loggedMinutes`; create and update accept `estimateMinutes`.

## UI

Task properties panel: an **Estimate** row under Milestone (part of the Save bar), and a **Logged time** section above Time in status with the total against the estimate, the entries, and a **Log time** form.

## Tests

- `packages/validators/src/project.test.ts`: `parseDuration`, estimate and entry schemas.
- `apps/api/test/time-entries.e2e-spec.ts`: estimates, entry lifecycle and totals, validation, access and archived projects.
