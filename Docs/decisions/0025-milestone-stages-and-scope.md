# 0025 — Milestone stages and scope added after start

- **Status:** Accepted (user answers, 2026-11-27)
- **Date:** 2026-11-27
- **Scope:** Give milestones the stages of a client delivery, show work added to a delivery after it started, and ask the lead to move a finished delivery to client review
- **Builds on:** [0003](0003-projects-and-tasks.md) §10 (milestones, acceptance criteria), [0004](0004-collaboration.md) (activity, notifications), [0021](0021-status-automation.md) (prompts, never automatic), [0023](0023-project-leads-and-internal-triage.md) (leads manage milestones, `responsible()`), [0024](0024-triage-gate-and-milestone-scheduling.md) (tasks are scheduled into milestones)
- **Changes:** milestone status `OPEN | COMPLETED` (0003 §10) becomes four stages

## 1. Outcome

A milestone is a client delivery, and it moves through the stages an agency actually uses:

| Stage             | Meaning                                                            | Takes new tasks                  |
| ----------------- | ------------------------------------------------------------------ | -------------------------------- |
| **Planned**       | Scope is being agreed; work hasn't started                         | yes                              |
| **Active**        | The team is building it; the agreed scope is fixed from here       | yes, flagged "added after start" |
| **Client review** | Shipped to the client for checking against the acceptance criteria | yes, flagged (fixes from review) |
| **Delivered**     | The client has it; the milestone is closed                         | no                               |

Business owners see how much was added after a delivery started. Developers see which delivery a task belongs to and when it's due. Nothing moves a milestone on its own; DevTracker asks.

## 2. Stages

- `milestone_status` values: `PLANNED`, `ACTIVE`, `CLIENT_REVIEW`, `DELIVERED`.
- **Any stage can move to any other**, by leads and workspace Owners/Admins (`manage`), as today. No workflow engine (same rule as task status, 0003 §6).
- **New milestones start as Planned.** `POST /projects/:id/milestones` may pass another stage.
- **Timestamps:** `started_at` is set the first time a milestone enters Active and is never cleared (it marks when scope was agreed). `delivered_at` is set on entering Delivered and cleared on leaving it.
- **Activity:** a stage change records `milestone.stage_changed` with `{ from, to }`. Entering Delivered records `milestone.completed` instead, as completing does today, so the feed shows it once.
- **Notifications:** entering Delivered sends `MILESTONE_COMPLETED` to everyone on the project, as today, now reading "Milestone "v1.2" delivered in DEV".
- **Taking tasks:** Delivered milestones take no new tasks. Every task-to-milestone path refuses them with `400`: create, edit, bulk edit, Triage accept (0024 §3) and both milestone pickers. The pickers show Planned, Active and Client review.

## 3. Added after start

- **Data:** `tasks.milestone_added_at timestamptz`, set whenever a task's milestone changes to a non-null value (create, edit, bulk edit, Triage accept), and cleared when the milestone is removed.
- **The rule:** a task is **added after start** when its milestone has a `started_at` and `milestone_added_at > started_at`. Computed on read; nothing else is stored.
- **Tasks from before this change** have no `milestone_added_at` and are never flagged. The count starts honest from the deploy on.
- **Where it shows:**
  - each milestone: "**3 of 12 tasks added after start**" next to its real done/total count;
  - the task page and board card: an "Added after start" badge beside the milestone name;
  - the milestone filter on board and list has **Added after start** (`?milestoneId=added`), across the project's milestones.
- `Task` gains `addedAfterStart: boolean`; `Milestone` gains `startedAt`, `deliveredAt` and `taskCounts.addedAfterStart`.
- Moving a task between milestones resets its `milestone_added_at`, so it's judged against the milestone it's in now.

## 4. "Move to client review?"

- **When:** an **Active** milestone has at least one task, every task in it is Done, and every acceptance criterion is ticked.
- **What:** the Milestones page shows a banner on that milestone: "Everything is done. Move to Client review?" with **Move to Client review** and **Not yet**. It's computed on read, so it disappears as soon as a task reopens or a criterion is unticked.
- **Notification:** the first time a milestone becomes ready, its leads (or the project's Owners/Admins if it has none, `responsible()`) get one `MILESTONE_READY` notification linking to the Milestones page. It isn't sent again until the milestone stops being ready and becomes ready again.
- **Checked** when a task in the milestone moves to Done (single, bulk and "Mark done?" paths), when a criterion is ticked, and when a task joins or leaves the milestone.
- **Not yet** hides the banner for that person until the milestone's state changes (stored in the browser; it's a convenience, not a record).
- DevTracker never moves the milestone itself (same principle as 0021 §4).

## 5. Website

- **Milestones page:** sections by stage (Active, Client review, Planned, then Delivered collapsed). Each milestone shows its stage as a menu (for leads and admins) with the due date, real counts and the added-after-start count. The complete/reopen toggle becomes that menu.
- **Task page, board card, list row:** the milestone name keeps its current place; the "Added after start" badge sits next to it.
- **Pickers** (task, bulk, Triage accept, quick add): stage shown beside each name, Delivered left out.
- Tokens only, per SPEC. No invented progress numbers (SPEC §3): counts are real.

## 6. Migration

One migration per build step (§8), each run only after the user approves the SQL.

- **`0028_milestone_stages` (step 1):** moves `milestones.status` through `text`, maps `OPEN` → `ACTIVE` and `COMPLETED` → `DELIVERED`, recreates `milestone_status` as `PLANNED, ACTIVE, CLIENT_REVIEW, DELIVERED` with default `PLANNED`, adds `started_at` and `delivered_at`, and backfills `delivered_at` from `updated_at` for delivered milestones. Recreating the type (rather than `ADD VALUE`) lets the new default be used in the same transaction.
- **Step 2:** `tasks.milestone_added_at timestamptz`.
- **Step 3:** `notification_type` gains `MILESTONE_READY`.
- **Existing milestones:** open ones become **Active** (they're being worked on), completed ones **Delivered**. `started_at` stays null for them, so their existing tasks aren't flagged.
- **Not additive:** code that writes `OPEN`/`COMPLETED` stops working the moment `0028` runs. Run it and deploy the API and website straight after; reads keep working in between.

## 7. Out of scope (later steps)

- Linking GitHub releases to milestones (step 3 of the delivery plan).
- The business-owner overview across projects (step 4).
- Client sign-off by link and status emails (step 5).
- Estimates or logged time per milestone (needs its own decision; 0012 excludes reports).

## 8. Build order (one PR each)

1. **Stages:** migration, API (stages, timestamps, activity, Delivered refusing tasks), Milestones page stage menu and sections, pickers.
2. **Added after start:** `milestone_added_at`, the computed flag and counts, badges, the filter.
3. **Move to client review?:** readiness check, banner, `MILESTONE_READY`.

## 9. Decisions (user answers, 2026-11-27)

1. **Stage names:** Planned / Active / Client review / Delivered.
2. **Existing open milestones** become Active; completed ones Delivered.
3. **Client review takes new tasks,** flagged as added after start.
4. **"Move to client review?"**: a banner plus one notification to the leads (or admins).

## 10. Tests

End-to-end on PGlite:

- stage changes by leads and admins, refused for members; timestamps; activity; `MILESTONE_COMPLETED` on Delivered only;
- Delivered refuses tasks on every path; pickers' data leaves it out;
- added after start: before and after `started_at`, moved between milestones, removed, old tasks unflagged; counts and filter;
- readiness: becomes ready and un-ready with tasks and criteria; one notification per readiness, to leads or admins.
