# 0029 — Plan a delivery in one place: new milestones from New task, and tasks from a milestone

- **Status:** Accepted (user answers, 2026-11-28)
- **Date:** 2026-11-28
- **Scope:** Let a lead create a milestone while creating a task, and add tasks straight into a milestone from the Milestones page
- **Builds on:** [0003](0003-projects-and-tasks.md) §10 (milestones), [0023](0023-project-leads-and-internal-triage.md) (leads manage milestones), [0024](0024-triage-gate-and-milestone-scheduling.md) §3–4 (milestone or Unscheduled, status from the milestone), [0025](0025-milestone-stages-and-scope.md) (stages, Delivered takes no tasks, added after start)

## 1. The problem

A milestone is one client delivery that holds many tasks, and its goals are its acceptance criteria. Planning one today means jumping between pages:

- **New task** on the board only lists milestones that already exist. If the delivery doesn't exist yet, the lead must leave, create it on the Milestones page, and come back. (The Triage **Accept** dialog already has **New milestone…**, so the two places disagree.)
- The **Milestones** page can't add tasks. It only links to "View tasks".
- When triage is off, quick add shows no milestone picker at all; the milestone can only be set afterwards on the task page.

## 2. Outcome

A lead can start from either side and never switch pages:

- **Task first:** writing a task, they pick **New milestone…**, type its name, and the task is created inside the new milestone.
- **Milestone first:** on the Milestones page they create "v1 Checkout", write its goals (acceptance criteria), then add its tasks right there.

One milestone still holds many tasks. Nothing about stages, sign-off, releases or the Overview changes.

## 3. "New milestone…" in New task

- The milestone picker on the board's **New task** form (the button, `N`, the sidebar's `?new=1`, and each column's **+**) gains **New milestone…**, shown only to people who manage milestones (leads and workspace Owners/Admins, `viewerCanManage`), exactly as in the Accept dialog.
- Choosing it shows a **New milestone name** field (100 characters). On Add, DevTrack creates the milestone (**Planned**, no due date), then creates the task in it.
- The status follows 0024 §4 unchanged: **New task** puts a task with a milestone in To do; a column's **+** keeps that column.
- Hint under the field: "You can add a due date and acceptance criteria on the Milestones page."
- **If the task fails after the milestone was created,** the milestone stays (empty) and the form says so; retrying picks it from the list. Same as the Accept dialog today.
- **When triage is off,** the picker is shown too, optional, defaulting to **No milestone** (today's behavior: To do, or the column's status). Decision 1.
- Members who propose (0024 §2) still see no picker: the triager chooses.

## 4. "Add task" inside a milestone

- Each milestone that isn't **Delivered** gets an **Add task** row under its counts, for anyone who can create tasks directly (not for members who must propose, not on archived projects).
- It's a one-line title field with **Add** (Decision 2), like the board's quick add. The task is created with that milestone and **no status**, so it starts in **To do** (0024 §4).
- After adding, the milestone's counts refresh, and the new task appears in a short list of the milestone's open tasks (Decision 3), each linking to its task page. "View tasks" stays for the full list.
- Tasks added to an **Active** or **Client review** milestone are flagged **added after start** as usual (0025 §3): that's the point of the flag.
- Delivered milestones show no **Add task** (0025 §2).

## 5. API and data

No migration and no new endpoint. Both features reuse:

- `POST /projects/:id/milestones` `{ name }` (leads and admins),
- `POST /projects/:id/tasks` `{ title, milestoneId }` (anyone who may create directly; `403 PROPOSAL_REQUIRED` for proposers; `400` for a Delivered milestone).

## 6. Website

- `board.tsx` quick add: picker gains **New milestone…** and the name field; picker shown when triage is off too.
- `milestones-page.tsx`: an **Add task** row and the open-tasks list per milestone.
- Tokens only, per SPEC. No invented numbers: counts stay real.

## 7. Out of scope

- "New milestone…" in the task page's milestone field and in bulk edit (they can follow if wanted).
- Goals or checklists on individual tasks (the milestone's acceptance criteria are the goals).
- Making a milestone required for every task (0024 §1: upkeep work has no delivery).

## 8. Decisions (user answers, 2026-11-28: the recommended options)

1. **Picker when triage is off:** show it, optional, default "No milestone". _(Recommended.)_ Alternative: keep today's form with no picker.
2. **Add task in a milestone:** title-only quick add, details on the task page. _(Recommended.)_ Alternative: a full New task dialog (description, priority, assignees).
3. **Show the milestone's open tasks** on the Milestones page under Add task (title, key, status, assignee avatar). _(Recommended.)_ Alternative: counts only, plus "View tasks".

## 9. Build

One PR: website only, plus end-to-end checks that a new milestone + task land together and that Add task puts the task in To do in that milestone, refused for Delivered and for proposers.
