# 0020 — Task relations: blocks, blocked by, related

- **Status:** Accepted (user approval, 2026-11-22)
- **Date:** 2026-11-22
- **Scope:** Record which tasks hold others up, and which belong together
- **Builds on:** [0003](0003-projects-and-tasks.md) (tasks and access), [0017](0017-search.md) (search, used by the picker)

## 1. Outcome

A task can **block** another, be **blocked by** another, or be **related to** another task in the same workspace. Each relation shows on both tasks. Board cards and the task's property strip show **Blocked** while an open (not Done) task blocks it.

## 2. Data (migration `0020_task_relations.sql`, additive)

```sql
CREATE TYPE task_relation_type AS ENUM ('BLOCKS', 'RELATES');
CREATE TABLE task_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
  related_task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
  type task_relation_type NOT NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_relations_pair_unique UNIQUE (task_id, related_task_id, type),
  CONSTRAINT task_relations_not_self CHECK (task_id <> related_task_id));
CREATE INDEX task_relations_related_idx ON task_relations (related_task_id, type);
```

- **`BLOCKS` has a direction:** `task_id` blocks `related_task_id`. "A is blocked by B" is stored as "B blocks A".
- **`RELATES` has no direction:** it's stored once, with the smaller id in `task_id`. Adding it again from the other task is a duplicate.
- **Refused with 409:**
  - adding the reverse block (A blocks B while B blocks A);
  - duplicates;
  - linking a task to itself.

## 3. API

| Method | Path                               | Notes                                                                                                      |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/tasks/:id/relations`             | `{ relations: RelatedTask[] }` grouped Blocked by → Blocks → Related, each from this task's side (`kind`). |
| POST   | `/tasks/:id/relations`             | `{ kind: 'BLOCKS' \| 'BLOCKED_BY' \| 'RELATES', taskId }` → the updated list                               |
| DELETE | `/tasks/:id/relations/:relationId` | 204. Works from either task.                                                                               |

- **Who can add one:** edit rights on the task, view rights on the other task, and both tasks in the same workspace. A task the caller can't see is answered as "not found" (400 on `taskId`).
- **What the list shows:** only related tasks the caller can see, not deleted. A member who isn't on the other task's project doesn't see that relation.
- **Board count:** tasks carry `blockedByCount`, the number of open (not Done, not deleted) tasks blocking them. It's computed in the same per-task totals query as logged time and checklist counts, so a board page still uses 4 queries.

## 4. Activity and live updates

- **Activity:** adding or removing a relation writes an entry on **both** tasks, worded from each side: "marked this as blocked by FF01-2" on one, "marked this as blocking FF01-3" on the other.
- **Metadata:** each entry holds both task keys and the relation, all display details.
- **Removing a link to a hidden task:** when the caller removes a link to a task they can't see, only their own task gets the entry.
- **Live updates:** each change sends `task.updated` with `relation: true`, so open pages and boards refresh.

## 5. Website

- **Task page:** a **Relations** section after the Checklist.
  - **Groups:** Blocked by, Blocks and Related to.
  - **Each row:** a status dot, the key and the title, which links to the task. The project name shows when the task is in another project.
  - **Remove:** an × appears on hover or focus, and is always visible on touch screens.
- **Link task:** opens a dialog. You choose **Is blocked by / Blocks / Relates to**, then search by key or title using workspace search (0017). Tasks already linked are disabled.
- **Property strip:** a red "Blocked by N tasks" chip while open blockers remain.
- **Board cards:** a red "Blocked" label with an icon. Screen readers hear "Blocked by N open tasks".

## 6. Tests

- Each kind from both sides, and their mirrors.
- Duplicates from either side, the reverse block and self-links (409).
- `blockedByCount` going 1 → 0 when the blocker is Done.
- Activity worded from both sides.
- Removing from the other side, then a second remove (404).
- Visibility: a member can't link or see tasks in a project they're not on. The owner can. Outsiders get 404. An unknown `kind` gets 400.
