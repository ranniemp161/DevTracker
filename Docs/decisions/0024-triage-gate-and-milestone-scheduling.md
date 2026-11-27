# 0024 — Triage as the only way in, and scheduling into milestones

- **Status:** Accepted (user answers, 2026-11-27)
- **Date:** 2026-11-27
- **Scope:** Make Triage the gate every new task passes, and make accepting a task the moment it is placed into a milestone (a client delivery) or left unscheduled
- **Builds on:** [0003](0003-projects-and-tasks.md) (tasks, milestones), [0016](0016-request-form-and-triage.md) (request form, Triage), [0021](0021-status-automation.md) (accepting moves to To do), [0023](0023-project-leads-and-internal-triage.md) (leads, internal triage)
- **Changes:** 0023 §3 "internal triage only applies once the project has a lead", and 0021 §1 "a request accepted in Triage → `TODO`" (now only when it is accepted into a milestone)

## 1. Outcome

DevTrack follows an agency's delivery cycle: **request → scope → deliver**.

- Every new task enters through Triage, or is created by someone who triages (a lead or admin), who makes the triage decision on the spot.
- Accepting a task answers "which delivery is this part of?":
  - **into a milestone** → the task is committed to that delivery and moves to To do;
  - **Unscheduled** → the task is accepted but parked in Backlog.
- The Backlog column now has one meaning: accepted, not scheduled. To do and later mean committed to a delivery (or deliberately scheduled by hand).

Milestones stay optional. Upkeep work and small fixes don't belong to a delivery, and requiring one would breed fake milestones.

## 2. The triage gate (replaces 0023 §3 "only once the project has a lead")

- The project setting `internal_triage` is shown as **Require triage for new tasks**.
- **When it's on, it is in effect immediately**, with or without leads:
  - **Who triages:** the project's leads and workspace Owners/Admins (`canManage`). Without leads, that is the Owners/Admins.
  - **Who proposes:** everyone else. `POST /projects/:id/tasks` returns `403 PROPOSAL_REQUIRED`, as today.
  - The old "without a lead the gate means nothing" problem goes away: without leads, the admins hold the gate.
- **When it's off:** today's behavior exactly (0023 §4): everyone triages if the project has no leads, and anyone can create tasks directly.
- `REQUEST_SUBMITTED` recipients are unchanged: the project's leads, otherwise the workspace's Owners/Admins (`ProjectAccessService.responsible()`).
- **Default:** new projects start with it **on**. Existing projects keep their current value. One existing case changes: a project that already has the setting on but no lead now gates members, with admins triaging (under 0023 it had no effect).
- `POST /workspaces/:id/projects` accepts an optional `internalTriage` to start a project with it off; omitted means on.
- `Project.viewerMustPropose` and `viewerCanTriage` keep their names; only the rule behind them changes (`packages/server-core/src/access.ts`).

## 3. Accepting into a milestone (changes 0021 §1)

- `POST /requests/:id/accept` takes `{ milestoneId: uuid | null, assigneeIds?: uuid[] }`.
  - `milestoneId` is **required**, so the choice is always explicit; `null` means Unscheduled.
  - The milestone must belong to the project and be `OPEN` (`400` otherwise: "Choose an open milestone from this project.").
  - `assigneeIds` (optional, project members only, `NOT_PROJECT_MEMBER` otherwise) lets the triager hand the work out in the same step. Assigning sends `TASK_ASSIGNED` as usual.
- **With a milestone:** the task's `milestone_id` is set, and status automation moves it Backlog → To do (`trigger: 'request'`, forward-only rules of 0021 §2 apply).
- **Unscheduled:** the task stays in Backlog. The request is still `accepted`.
- One transaction, as today: request row, task fields, status move, activity (`task.updated` for the milestone and assignees, attributed to the triager), and `REQUEST_TRIAGED` to an internal proposer.
- **Activity and reporter notice** mention the milestone: "Accepted into v1.2 Checkout: <title>" or "Accepted (unscheduled): <title>".
- Declining is unchanged (0023 §4).

## 4. Creating directly (leads and admins)

When triage is required, the people who triage still create tasks directly. They are triaging their own work as they write it, so it doesn't queue for a second look.

- The New task form gets the same **Milestone or Unscheduled** choice.
- Default status follows the same rule: a milestone → To do, Unscheduled → Backlog. The creator can still pick another status, as today.
  - **API:** `POST /projects/:id/tasks` without `status` starts the task in Backlog when the project requires triage and no `milestoneId` is given, otherwise in To do.
  - **Board:** **New task** (the button, `N`, the sidebar's `?new=1`) sends no status, so the milestone choice decides; a column's own **+** keeps that column's status.
- No `task_requests` row is written: it isn't a request, and Triage stays a list of things waiting for a decision.
- When triage is off, the form is unchanged (milestone optional, To do by default).

## 5. Website

- **Triage → Accept** opens a small dialog: Milestone (open milestones, soonest due first, plus **Unscheduled**), optional assignees, and **Accept**. Leads and admins get **New milestone** in the picker, which uses the existing milestone create route (0023 lets leads manage milestones).
- **Project settings:** "Require triage for new tasks" with one line explaining who proposes and who triages. The "needs a lead first" hint from 0023 is removed.
- **Board and list:** the existing milestone filter (`milestoneId=none` is "No milestone") is labeled **Unscheduled** for Backlog tasks; no new view in this step.
- Tokens only, per SPEC.

## 6. Migration (additive)

`0027_triage_by_default`: `ALTER TABLE projects ALTER COLUMN internal_triage SET DEFAULT true;`

It changes no existing rows. It runs against the shared database only after the user approves the SQL.

## 7. Out of scope (later steps from the delivery-cycle plan)

- Milestone stages (Planned → Active → Client review → Delivered) and "added after start" scope flags — step 2.
- Linking GitHub releases to milestones — step 3.
- A business-owner overview across projects — step 4.
- Client sign-off and status emails — step 5.
- Moving a Backlog task to To do when someone later sets its milestone by hand (§8, decision 3).

## 8. Decisions (user answers, 2026-11-27)

1. **New projects require triage by default:** yes. Existing projects keep their current setting.
2. **Leads and admins create directly** when triage is required, choosing a milestone or Unscheduled.
3. **Scheduling later** does not move the task: setting a milestone on an Unscheduled Backlog task leaves its status alone; the person moves it.
4. **Assignees at accept:** included, optional.

## 9. Build order (one PR each)

1. **Gate:** the access rule change, the default, the settings copy. API e2e for the access matrix with and without leads.
2. **Accept into a milestone:** accept body, validation, status rule, activity and notice text, the Accept dialog.
3. **Direct create:** Milestone/Unscheduled on the New task form and its status default.

## 10. Tests

End-to-end on PGlite:

- triage required, no leads: members get `PROPOSAL_REQUIRED`, admins create directly and triage;
- triage required, with leads: leads triage, members propose; triage off: unchanged behavior;
- accept with an open milestone → milestone set, To do; with `null` → Backlog; with a completed or another project's milestone → 400; missing `milestoneId` → 400;
- assignees at accept: project members only, `TASK_ASSIGNED` sent;
- `REQUEST_TRIAGED` text for both outcomes; direct create status defaults.
