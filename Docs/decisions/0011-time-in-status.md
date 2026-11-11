# 0011 - Time in status

- **Status:** Accepted
- **Date:** 2026-11-11
- **Changes scope:** Architecture §18 excludes "Time tracking and timesheets" and "Advanced reporting/analytics" from the MVP. This record deliberately opens the first, in two steps. Reporting across tasks stays excluded.

## Purpose and scope

Show where a task's time actually goes, so the team can see which stage of the workflow is slow before adding any workflow rules.

- **Step 1 (this record):** time spent in each status, per task. Read-only, no new tables.
- **Step 2 (separate record and PR):** manually logged time entries and an estimate on tasks. Needs a migration.

Not in scope: timers, timesheets, project-wide or per-person reports, WIP limits, restricted transitions. Status rules are unchanged: any status can still move to any other (record 0003), and GitHub events still never change task status (§7.5).

## Rules

1. **Source of truth is the activity log.** Task creation logs the first status (`task.created`, `metadata.status`) and every status change logs `task.updated` with `metadata.changes.status = { from, to }`, both in the transaction that makes the change. Activity is kept as product history (record 0008 §3), so the history is complete.
2. **No stored durations.** Time is computed on read by walking that history. The current status is counted up to the moment of the request (`asOf`).
3. **Repeat visits add up.** A task that returns to a status accumulates there. Statuses the task never entered are omitted.
4. **Start to done** is the time from the first move into In progress until `completed_at`. It is `null` unless the task is done and was in progress at some point.
5. **Elapsed time, not working time.** Nights and weekends count. This is not a record of effort; logged time (step 2) is.
6. **Access:** anyone who can read the task can read its time. Outsiders get 404, as for the task itself.

## API

`GET /tasks/:id/time-in-status` returns `{ time: TaskTimeInStatus }` (`packages/types/src/project.ts`).

## UI

A **Time in status** section in the task properties panel, between Pull requests and the details list: one row per visited status (dot, name, duration), then **Start to done** when available. It re-fetches whenever the task changes.

## Tests

- `apps/api/src/tasks/time-in-status.spec.ts`: totals, repeat visits, cycle time.
- `apps/api/test/task-time.e2e-spec.ts`: history through the API, and access.
