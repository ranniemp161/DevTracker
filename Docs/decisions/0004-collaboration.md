# 0004 — Comments, mentions, activity feed, notifications and outbox

- **Status:** Accepted (M4)
- **Date:** 2026-11-06
- **Scope:** Milestone M4 — architecture §7.4, §7.6, §7.7, §8.2, §9 and §10
- **Records:** Open decision #7 (activity retention), deferred to M8

These rules were approved before implementation (§21 rule 12).

## 1. Comments

- Anyone with project access can comment. Comments are plain text, 1–10,000 characters.
- Comments are **never rendered as HTML**. React escapes the text, and mentions are highlighted as text spans, so stored XSS isn't possible.
- **Editing:** only the author can edit a comment. Edited comments show as "edited" (`edited_at`).
- **Deleting:** the author can delete their own comments. Workspace Admins and the Owner can delete anyone's (moderation, §7.4) but cannot edit them.
- Deletion is a **soft delete**: the thread shows a "deleted" placeholder, with no body or mentions.
- Comments are listed **oldest first** with cursor pagination.
- Archived projects are read-only.
- Rate limit: 60 comments per 10 minutes per user (§14).

## 2. Mentions

- `@username` is parsed by `parseMentions()` (`@devtrack/validators`), which the API and website share. Email addresses don't count, and a comment can mention at most 20 people.
- A mention only resolves if that user **can access the project**: a project member, or a workspace Admin/Owner. Anyone else is ignored, so a mention can't expose a task to an outsider.
- **Edits:** newly added mentions are notified once. Removed mentions are dropped from `comment_mentions`. Mentions that were already there are not notified again.

## 3. Activity

- `activity_logs` rows are written **in the same transaction** as the change they describe, through `EventRecorder.activity()`.
- Recorded actions:

  | Entity      | Actions                                                                           |
  | ----------- | --------------------------------------------------------------------------------- |
  | `task`      | `created`, `updated`, `deleted`, `assigned`, `unassigned`, `labeled`, `unlabeled` |
  | `comment`   | `created`, `deleted`                                                              |
  | `project`   | `created`, `updated`, `archived`, `member_added`, `member_removed`                |
  | `milestone` | `completed`                                                                       |

- An update that changes nothing records nothing.
- **Metadata is minimal**, for example `changes.status: { from, to }`. A description change is recorded as `{ changed: true }`, without the text. Comment text never appears in activity or events (§8.4). Tests check this.
- `activity_logs.task_id` (an M4 addition) supports the per-task history.

## 4. Activity feed

- `GET /projects/:id/activity` returns entries **newest first** with cursor pagination, scoped by project access.
- An optional `?taskId=` returns a single task's history (an M4 addition to §9).
- Each entry includes the actor and the task's key and title.

## 5. Notifications

- The four §7.7 types that exist before GitHub integration:

  | Type                  | Who is notified                                                                                                      |
  | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | `TASK_ASSIGNED`       | New assignees                                                                                                        |
  | `MENTIONED`           | Mentioned users who can access the project                                                                           |
  | `COMMENT_RECEIVED`    | The reporter and assignees who can still access the project, unless already notified about this comment by a mention |
  | `MILESTONE_COMPLETED` | Everyone with project access                                                                                         |

- The enum already includes `PULL_REQUEST_OPENED`, `PULL_REQUEST_MERGED` and `PULL_REQUEST_REVIEWED`. They are emitted from M6.
- Nobody is notified about their own action.
- Users see notifications **only from active workspaces they still belong to**. After leaving a workspace, its notifications (which include task titles) disappear.
- `PATCH /notifications/:id/read` returns 404 for someone else's notification.
- Each notification carries a `link` (an in-app path) and a `project_id` (an M4 addition, used to build that link).
- Until M7 brings real-time delivery, the header bell refreshes the unread count on navigation and every 60 seconds.

## 6. Transactional outbox (§10, §21 rule 7)

- `outbox_events` rows are written in the same transaction as each business change. Event types:
  - **domain events:** `task.created`, `task.updated`, `task.deleted`, `task.assigned`, `comment.created`, `comment.updated`, `comment.deleted`;
  - **feed and notification events:** `activity.created`, `notification.created`, `notification.read`.
- `payload` is the §10 envelope: `type`, `version`, `occurredAt`, `workspaceId`, `projectId`, `actor`, `entity`, `payload`. It holds IDs and changes only, no comment text.
- `aggregate_id` is the entity ID, or the recipient's user ID for notification events.
- A test checks that a failed transaction also rolls back its activity, notification and outbox rows.
- **There is no publisher yet.** M7 adds the publisher that delivers unpublished rows to authorized Socket.IO rooms and sets `published_at` and `attempts`.

## 7. Retention (open decision #7)

Everything is kept for the MVP. The pruning policy for `activity_logs`, `outbox_events` (after publishing) and old notifications will be decided in M8.

## Implementation notes

- `EventRecorder` lives in a global `EventsModule` that depends only on the database. Business modules call it inside their transactions, and read-side modules (activity, notifications) are separate, so modules never import each other in a cycle.
- Comments, activity and notifications are paginated by `(created_at, id)`. Their `created_at` columns use millisecond precision (`timestamptz(3)`), so cursors built from JavaScript dates match stored values exactly.
- `TaskAccessService` (moved out of `TasksService`) is the shared "load a live task and authorize through its project" entry point.
- **Tooling:** `.gitattributes` now forces LF line endings. Without it, `core.autocrlf=true` checkouts produced CRLF/LF churn against Prettier. The API's Vitest config was renamed to `vitest.config.mts` to remove an ESM-in-CommonJS warning.

## Task timeline (added 2026-11-14)

- `GET /tasks/:id/timeline?kind=all|comments&cursor&limit` returns a task's comments and activity in one list, oldest first, for the task detail Activity section (SPEC §5). Items are `{ kind: 'comment', comment }` or `{ kind: 'activity', entry }`, in the same shapes as the comments and activity endpoints.
- Both sources are merged and paged in one SQL query (cursor: time + id), so pages never overlap or leave gaps. `limit` is 1–100 (default 50).
- Comment activity (`comment.created`, `comment.deleted`) is left out, because the comment, or its deleted placeholder, is already in the list. The project activity feed still shows it.
- Access matches the comments endpoint: anyone who can see the task, and 404 otherwise. `GET /tasks/:id/comments` and the project feed are unchanged.
