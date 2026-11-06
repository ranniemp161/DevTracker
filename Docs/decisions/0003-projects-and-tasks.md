# 0003 — Projects, project membership and tasks

- **Status:** Accepted (M3)
- **Date:** 2026-11-06
- **Scope:** Milestone M3 — architecture §7.2, §7.3, §8.2 and §9 (projects, tasks)
- **Resolves:** Open decision #6 (task deletion policy)

These rules were approved before implementation (§21 rule 12).

## 1. Who can see projects

- Workspace **Owners and Admins** see and manage every project in the workspace.
- **Members** see only the projects they belong to (§6: "access assigned projects").
- Anyone else gets the **same 404** as for a nonexistent project or task.
- [`ProjectAccessService.require()`](../../apps/api/src/projects/project-access.service.ts) is the single entry point for project authorization, and every task route goes through it.

## 2. Creating projects and managing members

- Only workspace Admins and the Owner can create projects. The creator becomes a project member.
- Only existing workspace members can be added to a project (`NOT_WORKSPACE_MEMBER` otherwise).

## 3. Project key and archiving

- The key is 2–10 upper-case letters or digits, starting with a letter. It is unique per workspace (`PROJECT_KEY_TAKEN`) and **immutable**, because task keys (`DEV-104`) depend on it.
- `DELETE /projects/:id` sets status `ARCHIVED`. Create and update cannot set `ARCHIVED`.
- Archived projects are **read-only**: every write returns `409 PROJECT_ARCHIVED`. Reads still work.
- `GET /workspaces/:id/projects` hides archived projects unless `?includeArchived=true`.

## 4. Task numbers

- `projects.next_task_number` (gap 2) is incremented with `UPDATE … SET n = n + 1 RETURNING n - 1` inside the task-creation transaction.
- The row lock serializes concurrent creators, so numbers are unique. Numbers are never reused, even after a task is deleted.
- An integration test creates 15 tasks in parallel to check this.

## 5. Deleting tasks (open decision #6)

- Tasks are **soft-deleted** (`tasks.deleted_at`). Deleted tasks are hidden from every endpoint (404), but the rows are kept.
- Only the task's reporter or a workspace Admin/Owner can delete it.

## 6. Status changes

- Any status can move to any other. There is no workflow engine (§18 excludes custom workflows).
- `completed_at` is set when a task enters `DONE` and cleared when it leaves.

## 7. Assignees and cascades

- Assignees must be **project members** (`NOT_PROJECT_MEMBER`). A workspace admin who isn't a project member must be added to the project before they can be assigned.
- Removing someone from a project unassigns them from that project's tasks.
- Removing someone from a workspace removes their project memberships and task assignments in that workspace. This was the follow-up flagged in decision record 0002.

## 8. Board and list

- **Kanban:** one column per status. Dropping a card in another column calls `PATCH /tasks/:id/status`, with an optimistic update that rolls back on error.
- Within a column, cards are ordered by priority, then oldest first. There is no manual ordering (no `position` column in the schema).
- **List:** `GET /projects/:id/tasks` returns tasks newest first (by task number) and uses **cursor pagination**:
  - the response is `meta: { nextCursor, hasMore }`;
  - the cursor is opaque base64url;
  - `limit` is 1–200 (default 50);
  - filters: `status`, `priority`, `assigneeId`.

## 9. Labels (added to M3, approved)

- Labels are **workspace-scoped**: `name` (1–40 characters, unique per workspace case-insensitively, `LABEL_NAME_TAKEN`) and `color` (`#rrggbb`, stored lower-case).
- **Any workspace member can create** a label, so people can label while triaging. **Admins and the Owner rename, recolor and delete** labels. Deleting a label detaches it from every task.
- New endpoints:

  | Endpoint                          | Purpose                           |
  | --------------------------------- | --------------------------------- |
  | `GET/POST /workspaces/:id/labels` | List and create labels            |
  | `PATCH/DELETE /labels/:id`        | Rename, recolor and delete labels |

  The §9 routes `POST /tasks/:id/labels` (`{ labelId }`) and `DELETE /tasks/:id/labels/:labelId` attach and detach them.

- A label from another workspace cannot be attached (404). This is the cross-workspace link protection from §8.4.
- Tasks include `labels[]`, and the task list accepts `labelId` as a filter.

## 10. Milestones (added to M3, approved)

- Fields as in §8.2: `name`, `description`, `due_date` and `status` (`OPEN` | `COMPLETED`).
- Anyone with project access can read milestones. **Admins and the Owner manage them**, like project settings. They are read-only in archived projects.
- New endpoints:

  | Endpoint                            | Purpose                                                             |
  | ----------------------------------- | ------------------------------------------------------------------- |
  | `GET/POST /projects/:id/milestones` | List and create milestones                                          |
  | `PATCH/DELETE /milestones/:id`      | Update and delete milestones (hard delete; nothing depends on them) |

- The list shows open milestones first, then by due date (undated last).
- **Tasks are not linked to milestones.** The §8.2 schema has no link, and adding one needs approval. The "milestone completed" notification belongs to M4.

## Still deferred

- **Task activity records** (§7.3): these come in M4, which builds `activity_logs`.

## Other notes

- `GET /projects/:id/members` and the workspace project list are plain arrays, because they stay small.
- New error codes: `PROJECT_KEY_TAKEN`, `PROJECT_ARCHIVED`, `NOT_WORKSPACE_MEMBER`, `NOT_PROJECT_MEMBER`.
- A task-creation rate limit applies: 600 per hour per user.
