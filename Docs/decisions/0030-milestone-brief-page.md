# 0030 — The milestone as a brief: plan deliveries milestone first

- **Status:** Accepted (user answers, 2026-11-28); built (steps 1–3)
- **Date:** 2026-11-28
- **Scope:** Give each milestone its own page (goal, description, files, acceptance criteria, tasks with assignees), make New task ask "which delivery?", and show the milestone on the task page
- **Builds on:** [0003](0003-projects-and-tasks.md) §10 (milestones), [0018](0018-task-checklist.md) (task checklists), [0022](0022-request-attachments.md) and task attachments (uploads to R2), [0024](0024-triage-gate-and-milestone-scheduling.md) (milestone or Unscheduled; milestones stay optional), [0025](0025-milestone-stages-and-scope.md) (stages, added after start), [0028](0028-client-updates-and-sign-off.md) (sign-off page), [0029](0029-plan-deliveries-in-one-place.md) (tasks from a milestone)
- **Changes:** 0029 §3: New task no longer creates a milestone inline; it sends you to the milestone's page instead

## 1. The story

Planning starts with the delivery, not the task:

1. **New task** asks: "Which delivery is this for?"
2. Picking a delivery (or making a new one) opens the **milestone page**, the brief:
   - the **goal** (name) and a **description** in Markdown;
   - **files** that give context: screenshots, mockups, videos, `.md` specs;
   - **acceptance criteria**: what the client agreed counts as done;
   - **tasks**, each added with an **assignee**.
3. Whoever is assigned opens their task and sees **which delivery it belongs to**: the goal, stage, due date and criteria. Their own **checklist** (0018) is how they'll do their piece.

Two layers, two jobs: the **milestone** is what we promised the client; the **checklist** is how I'll do my part.

Small chores (a typo, renewing a certificate, an urgent fix) don't belong to a delivery. They keep a short road: **No milestone (quick task)** adds them straight to the board (0024 §1: milestones stay optional, no fake "Misc" milestones).

## 2. New task asks "Which delivery is this for?" (user answer: with a quick-task option)

**New task** (the board button, `N`, the sidebar, `?new=1`) opens a small chooser:

- **an open milestone** (Planned, Active or Client review, soonest due first) → its milestone page, with the Add task box focused;
- **New milestone** (leads and admins) → a name field, then the new milestone's page (Planned);
- **No milestone (quick task)** → today's quick add on the board (title only, Backlog when triage is required, To do otherwise).

- A column's **+** on the board stays a quick add for that column, as today (it's the fast path for people who know what they're doing).
- Members who **must propose** (0024 §2) are unchanged: **Propose task** → Triage; the triager picks the delivery when accepting.
- 0029's inline "New milestone…" in the board picker is replaced by the chooser's **New milestone**.

## 3. The milestone page `/projects/[id]/milestones/[milestoneId]`

Top to bottom, in the order a brief is written (user answer: criteria before tasks; any section can be edited at any time):

1. **Header:** name (the goal), stage menu (leads and admins), due date, "Approved by … on …" when the client approved (0028), and the "Move to Client review?" banner (0025 §4).
2. **Description:** Markdown, up to 20,000 characters (up from 5,000), with Write and Preview, like task descriptions. Leads and admins edit it; everyone on the project reads it.
3. **Files:** the same types and size as task attachments (PNG, JPEG, GIF, WebP, MP4, WebM, QuickTime, Markdown; up to 50 MB each), uploaded straight to R2. Markdown files show a rendered preview. Leads and admins add and remove them. Hidden when uploads aren't configured.
4. **Acceptance criteria:** as today (0003 §10).
5. **Tasks:** every task in the milestone, open first then Done, each with status, key, title and assignees, linking to the task.
   - **Add task:** a title and an **Assign to** picker (project members, optional), for anyone who can create tasks directly (not proposers, not on Delivered milestones). The task starts in **To do** (0024 §4) and assigning sends `TASK_ASSIGNED` as usual.
   - Added after start is flagged as today (0025 §3).
6. **Releases** (0026) and the **sign-off link** (0028), as today.

The **Milestones** list page becomes a summary: each milestone shows its name, stage, due date, done/total, criteria met and added-after-start, and links to its page. Creating a milestone from the list opens its new page.

## 4. The task page shows its milestone

When a task belongs to a milestone, a **Milestone** card sits above the description:

- the milestone's name (linking to its page), stage and due date (Overdue when past);
- the first lines of its description;
- "2 of 4 criteria met", with the criteria listed (read-only);
- the "Added after start" badge when it applies (0025 §3).

The task's own **checklist** (0018) stays where it is, under a clearer heading: "Your checklist".

The task **description** stays (requests, proposals, sign-off changes and bug details live there, and quick tasks have no brief), but an empty one is a small **+ Add description** button instead of an open editor (user review, 2026-11-28), so the brief and the checklist sit together. Changing the task's milestone stays in the task's fields, as today.

## 5. Data and API

- **Migration `0035_milestone_attachments`:** a `milestone_attachments` table shaped like `task_attachments` (`id`, `milestone_id` FK cascade, `uploader_id` FK set null, `name`, `content_type`, `size`, `created_at`, `completed_at`). The milestone description limit grows to 20,000 characters (validator only; the column is already `text`).
- **API:**
  - `GET /milestones/:id` → one milestone (as in the list, with counts, criteria, releases, approval). Project access; `404` otherwise.
  - `GET /milestones/:id/attachments` → `{ attachments, uploadsEnabled }` (everyone on the project; `uploadsEnabled` only for leads and admins on active projects); `GET …/:attachmentId/content` for Markdown previews.
  - `POST /milestones/:id/attachments` `{ name, contentType, size }` → an upload URL (leads and admins); `POST /milestones/:id/attachments/:attachmentId/complete`; `DELETE /milestones/:id/attachments/:attachmentId`. Same flow, types and checks as task attachments.
  - Storage: the same R2 keys as task media (`task-media/<id>`, staged under `pending-task-media/`), so the CDN Worker, CORS and the lifecycle rule need no change. Removing a file deletes its object.
  - Tasks: no change. Listing a milestone's tasks uses the existing `GET /projects/:id/tasks` filtered by `milestoneId`; creating uses `POST /projects/:id/tasks { title, milestoneId, assigneeIds }` (check `assigneeIds` is accepted on create; add it if not).
- **Not shared with the client:** milestone files and the description stay internal. The sign-off page keeps showing only what 0028 §3 lists.

## 6. Out of scope

- Comments or chat on a milestone.
- Showing milestone files to the client on the sign-off page (could follow later).
- Making a milestone required (0024 §1).

## 7. Build (one PR each)

1. **The milestone page and New task chooser:** the page with description, criteria, tasks with assignees, releases and sign-off; the summary list linking to it; New task's "Which delivery is this for?"; `GET /milestones/:id`; the 20,000-character description.
2. **Milestone files:** migration `0035`, the upload API, the Files section.
3. **The task page's Milestone card** and the "Your checklist" heading.

## 8. Decisions (user answers, 2026-11-28)

1. **Quick tasks:** keep **No milestone (quick task)** for small work that isn't part of a delivery.
2. **Order on the page:** goal and description → files → acceptance criteria → tasks.

## 9. Tests

- `GET /milestones/:id`: members read, outsiders `404`; attachments listed.
- Milestone attachments: leads and admins upload, complete, delete; members refused; same type and size limits as tasks; archived projects refused.
- Creating a task in a milestone with assignees: To do, assigned, `TASK_ASSIGNED` sent; Delivered refused; proposers refused.
- Description up to 20,000 characters accepted, longer refused.
