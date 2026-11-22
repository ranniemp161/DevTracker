# 0018 — Task checklists

- **Status:** Accepted (user approval, 2026-11-22: option A, checklist items rather than child tasks)
- **Date:** 2026-11-22
- **Scope:** Break a task into smaller steps that can be ticked off
- **Builds on:** [0003](0003-projects-and-tasks.md) (tasks), [0004](0004-collaboration.md) (activity)

## 1. Outcome

A task has an ordered **checklist**. Each item has text, an optional assignee and done/not done. The task page shows the list with progress ("2 of 5"), and board cards show "☑ 2/5".

## 2. Checklist items, not child tasks

Each item is a line inside the task. It has no key, status, comments or time of its own.

- **Why:** this covers the common need ("write tests", "update docs") without touching the board, filters, search or progress counts.
- **Later:** a "Convert to task" action can be added if child tasks are ever needed.

## 3. Data (migration `0019_task_checklist.sql`, additive)

```sql
CREATE TABLE task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  position integer NOT NULL,
  assignee_id uuid REFERENCES users ON DELETE SET NULL,
  done_at timestamptz, done_by uuid REFERENCES users ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX task_checklist_items_task_idx ON task_checklist_items (task_id, position);
```

- **Position:** orders items within a task. New items go at the end. If two concurrent adds tie, they sort by creation time.
- **Limit:** at most **100** items per task.
- **Task deleted:** soft-deleting the task hides its checklist with it. Removing the task row deletes the items.

## 4. API

| Method | Path                         | Notes                                                                                  |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/tasks/:id/checklist`       | `{ items }` in order. Anyone who can see the task.                                     |
| POST   | `/tasks/:id/checklist`       | `{ body, assigneeId? }` → `{ item }`                                                   |
| PATCH  | `/checklist-items/:id`       | `{ body?, done?, assigneeId? }` → `{ item }`. Ticking records `done_at` and `done_by`. |
| PUT    | `/tasks/:id/checklist/order` | `{ itemIds }` lists every item once, otherwise **409** (stale list) → `{ items }`      |
| DELETE | `/checklist-items/:id`       | 204                                                                                    |

- **Permissions:** changing the checklist needs the same rights as editing the task. Someone who can't see the task gets **404** for its items.
- **Assignees:** must be project members.
- **Counts:** every task response carries `checklist: { done, total }`. The board's per-page batch fetches the counts in the same query as logged time, so it still uses 4 database queries per page.

## 5. Activity and live updates

- **In the task's activity:** adding, completing, reopening and removing an item, as "completed a checklist item" and so on.
- **Item text stays out of activity**, the same as descriptions (§8.4 "display details only").
- **Live updates only:** edits and reorders send `task.updated` with `checklistItemId` and no feed entry. Open task pages and boards refetch.

## 6. Website

- **Task page:** a **Checklist** section between the description and Attachments.
  - **Header:** progress text and a progress bar.
  - **Items:** each has a checkbox and its text. Double-click or the ⋯ menu edits it, and the ⋯ menu also has Assign to me / Unassign me, Move up / Move down and Delete.
  - **Adding:** an "Add an item and press Enter" field at the bottom.
  - **Saving:** changes save straight away and show at once, before the server answers.
  - **Read-only projects:** the section is hidden when the checklist is empty.
- **Board cards:** "☑ done/total" in the footer, green when complete.
- **Reordering:** done with Move up / Move down, which works by keyboard and touch. Drag and drop can come later.

## 7. Tests

- Add, tick (with `doneBy`), edit, assign, reorder, reject a stale order, delete.
- Counts on the board list and on the task.
- Activity entries, with no item text in them.
- Validation: blank text, more than 500 characters, an assignee who isn't a project member, an empty update.
- Access: people outside the project and the workspace get 404.
