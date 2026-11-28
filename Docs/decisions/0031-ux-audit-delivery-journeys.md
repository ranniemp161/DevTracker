# 0031 — UX audit: the delivery journeys after 0030

- **Status:** Accepted (user answers, 2026-11-28); built (PRs #164, #165, #166 and this one)
- **Date:** 2026-11-28
- **Scope:** Fixes from a browser audit of production (QA test project), desktop (1280px) and phone (390px)
- **Builds on:** [0030](0030-milestone-brief-page.md) (milestone-first planning), design/SPEC.md

## 1. What was audited

1. **Lead plans a delivery:** board → New task → "Which delivery?" → milestone page (brief, files, criteria, tasks) → Milestones list → Overview.
2. **Dev picks up and finishes a task:** My tasks → task page (Milestone card, checklist, timer, PRs).
3. **Client signs off:** not driven in the browser. Getting a sign-off link needs a milestone in Client review, and moving one there emails the client (0028). Reviewed from the code and earlier tests instead.

## 2. Findings, most important first

### Bugs

1. **Overview links to the wrong page.** Each milestone on the Overview links to the project's Milestones list, not to the milestone's own page (`workspace-overview-page.tsx`, from before 0030). A lead taps "v1 Checkout" and has to find it again.
2. **The task page shows a wrong state while loading.** Until the project's milestones arrive, the milestone chip says "Milestone" (none) and the Milestone card is missing; then the card appears and pushes the page down. On a slow phone that's a visible jump and a moment of wrong information.

### Finding milestones

3. **Milestones is hidden.** Desktop sidebar: Board · List · Chat · _More_ → Milestones. Phone bottom bar: Board · List · Chat · **Timesheet** · More. Planning now starts at Milestones, but Timesheet has the better spot.
4. **Board cards don't say which delivery a task is for.** Cards show key, title, priority and assignee. Only the Milestone filter reveals it.
5. **My tasks doesn't show the delivery either.** Rows show project and priority; a dev with tasks in three milestones can't tell which delivery is due first.

### Noise on pages with little in them

6. **Empty sections take space on the task page.** Relations ("No linked tasks. Link one that blocks…") and Attachments ("No attachments yet.") each take a heading, a sentence and a button when empty. The description was fixed in #163; these two should follow.
7. **Zero counts are shown as facts.** Overview and Milestones show "0 added after start" on every Active milestone. It only matters when it's more than 0.
8. **The Milestones page opens with a full create form** (name, description, due date) for leads on desktop. Now that a new milestone opens its own page to write the brief, the description field there is redundant and the form pushes the list down.

### Phone

9. **On the task page, Timer and Pull requests sit below Activity.** On a phone the rail moves to the very end, under the comment box. Starting the timer means scrolling past everything.
10. **Small touch targets on the new milestone page.** Remove-file × (22px), remove-criterion × (26px), stage menu, Edit and Delete (30px) are under the 44px used elsewhere on touch screens (`pointer-coarse:` sizes).
11. **The "Which delivery?" dialog is slightly wider than the screen** at 390px (358px wide plus margins); its right edge touches the screen edge.

### Consistency

12. **Three ways to add a task look different.** The chooser (dialog), a column's + (inline card form) and Add task on the milestone page (one line with an assignee menu) differ in assignee, Enter behaviour and where the task appears. They can stay separate, but should share the same fields and feedback ("Added QA-10 · Open").

## 3. Proposed fixes

| #   | Fix                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Overview milestone links go to `/projects/:id/milestones/:milestoneId`.                                                                                    |
| 2   | Task page: the milestone chip and the card wait for milestones (a placeholder of the card's height while loading, no "none").                              |
| 3   | Milestones goes to the top level: desktop Board · Milestones · List · Chat; phone bar Board · Milestones · List · Chat · More (Timesheet moves into More). |
| 4   | Board cards show a small milestone tag (name, truncated) when the task has one.                                                                            |
| 5   | My tasks rows show the milestone next to the project.                                                                                                      |
| 6   | Relations and Attachments collapse to their buttons (**Link task**, **Attach file**) when empty.                                                           |
| 7   | "N added after start" shows only when N > 0.                                                                                                               |
| 8   | Milestones page: a **New milestone** button opens a small name + due date form (no description); creating opens the milestone page.                        |
| 9   | Phone task page: Time and Pull requests move above Your checklist (after the Milestone card).                                                              |
| 10  | Touch targets on the milestone page reach 44px on coarse pointers.                                                                                         |
| 11  | The dialog fits 390px (max width minus the 16px gutters).                                                                                                  |
| 12  | One task-added toast for all three ways ("Added QA-10" with **Open**), and the chooser's quick task keeps its assignee choice like the milestone page.     |

## 4. Build (one PR each, website only, no migration)

1. **Fixes:** 1, 2, 7, 11 (bugs and small polish).
2. **Navigation:** 3, 4, 5 (milestones visible everywhere).
3. **Quieter pages:** 6, 8, 9, 10.
4. **Consistent adding:** 12.

## 5. Out of scope

- Showing the brief or files to the client on the sign-off page (0030 §6).
- A board grouped by milestone (swimlanes). Worth doing after 4 if cards with tags aren't enough.

## 6. Decisions (user answers, 2026-11-28)

1. **Phone bar:** Board · Milestones · List · Chat · More (Timesheet in More).
2. **Order:** Build the four PRs in the order above (Fixes → Navigation → Quieter pages → Consistent adding).
