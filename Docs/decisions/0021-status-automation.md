# 0021 — Status automation and the "Mark done?" prompt

- **Status:** Accepted (user answers, 2026-11-23)
- **Date:** 2026-11-23
- **Scope:** Move tasks forward automatically from triage and GitHub events, and ask people before marking a task Done
- **Builds on:** [0003](0003-projects-and-tasks.md) (tasks, status, `completed_at`), [0004](0004-collaboration.md) (activity, notifications), [0006](0006-github-events.md) (webhook processing), [0011](0011-time-in-status.md) (status history), [0016](0016-request-form-and-triage.md) (triage)
- **Changes:** DEVTRACK_ARCHITECTURE.md §7.5 and §11.10 said task workflow stays fully manual. GitHub may now move a task **forward**, but still never to Done.

## 1. Outcome

DevTrack moves a task forward when the work shows it has moved:

| Trigger                                                                                | Moves the task to | Built in       |
| -------------------------------------------------------------------------------------- | ----------------- | -------------- |
| A request is accepted in Triage                                                        | `TODO`            | `requests`     |
| A pushed commit's message, or the pushed branch's name, contains the task key          | `IN_PROGRESS`     | `push`         |
| A linked pull request is opened (not as a draft), reopened, or marked ready for review | `IN_REVIEW`       | `pull_request` |
| A linked pull request is merged                                                        | — (asks, see §4)  | `pull_request` |

DevTrack never sets `DONE` on its own. People can still move any task to any status at any time.

## 2. Rules for every automatic move

- **Forward only.** Order: `BACKLOG` < `TODO` < `IN_PROGRESS` < `IN_REVIEW`. A move happens only when the target is later than the current status. A task already at or past the target is left alone.
- **Never out of `BLOCKED` or `DONE`.** Those tasks are skipped.
- **People win, but new events still count.** If someone moves a task back by hand, a **new** event can move it forward again (for example a new PR, a reopened PR, a new commit). Old events are never replayed.
- **Skipped:** deleted tasks, tasks in archived projects, and PR history imported when a repository is connected (it's history, not news; same rule as 0006).
- **Key matching:** keys come from `extractTaskKeys` and match only tasks in the project whose key they carry. A repository connected to several projects moves only tasks in the matching project.
- **Commits:** any branch counts, including the default branch. Only newly stored commits count (the existing `ON CONFLICT DO NOTHING` insert), so a webhook retry or a re-push moves nothing twice. A push that creates a branch with no new commits moves nothing.
- **Pull requests:** a draft PR doesn't count until it's marked ready for review. A key in the PR **title** doesn't count for `IN_PROGRESS`; it still auto-links the PR as today, so it counts for `IN_REVIEW`.
- **Triage:** accepting a request moves its task to `TODO` only while it's still `BACKLOG`.
- **Same transaction:** each move runs inside the webhook's (or the accept's) existing transaction, so a failed delivery retries the whole thing.

## 3. Recording a move

An automatic move is recorded exactly like a manual one, so the board, activity feed and time in status (0011) keep working:

- `tasks.status` changes; `completed_at` follows the same rule as manual changes (automation never sets Done, so it only ever stays or becomes null).
- Activity `task.updated` with `changes.status = { from, to }`, `actor = null`, and `metadata.automation = { trigger: 'request' | 'commit' | 'pull_request', repository?, sha?, prNumber?, url? }`.
- The outbox event `task.updated` with `{ taskId, changes }`, so open boards update live.
- **Shown as:** "DevTrack automation changed status from To do to In review · PR #42". The cause is text: the PR number, the short commit SHA, or "request accepted".
- No new notifications for automatic moves.

## 4. The "Mark done?" prompt

When a linked pull request merges and the task isn't `DONE`:

- **Who is asked:** the task's assignees, or the reporter if it has none. Only people who can still see the project. The person who merged is asked too: it's a to-do, not news about their own action.
- **Where:** a bell notification with a **Mark done** button, and a banner on the task page: "PR #42 was merged. Mark FF01-104 done?" with **Mark done** and **Dismiss**.
- **Replaces** today's "pull request merged" notification. Reporters and assignees no longer get that notification; only the prompt is sent.
- **Every merge asks.** A task with several linked PRs gets a prompt for each merge.
- **Stays until handled:** the prompt stays open until someone marks the task done, someone dismisses it, or the task reaches `DONE` another way. Dismissing closes it for everyone.
- **Mark done** goes through the normal task update path as the person who clicked it (their name in the activity, not automation).
- A task already `DONE` when its PR merges gets no prompt and no notification.
- A request task with no reporter and no assignees still gets the banner, but nobody gets a bell notification.

### Data (migration `0021_task_done_prompts.sql`, additive)

```sql
ALTER TYPE notification_type ADD VALUE 'TASK_DONE_PROMPT';
CREATE TABLE task_done_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES github_pull_requests ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users ON DELETE SET NULL,
  resolution text CHECK (resolution IN ('done', 'dismissed', 'status_done')),
  CONSTRAINT task_done_prompts_task_pr_unique UNIQUE (task_id, pull_request_id));
CREATE INDEX task_done_prompts_open_idx ON task_done_prompts (task_id) WHERE resolved_at IS NULL;
```

- `PULL_REQUEST_MERGED` stays in the enum for existing rows; new merges no longer use it.
- The local `.env` database is production's: the SQL is shown to the user before it runs.

### API

| Method | Path                                        | Notes                                                                                                     |
| ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | `/tasks/:id/done-prompts`                   | Open prompts for the task, each with its PR number, title and URL.                                        |
| POST   | `/tasks/:id/done-prompts/accept`            | Moves the task to `DONE` as the caller and resolves every open prompt on the task. 409 when none is open. |
| POST   | `/tasks/:id/done-prompts/:promptId/dismiss` | Resolves that prompt as dismissed for everyone. 409 when already handled.                                 |

- **Who:** edit rights on the task. Others get the usual 404/403.
- **Any move to `DONE`** (board, task page, bulk edit) resolves every open prompt on the task as `status_done`.
- Each resolve sends `task.updated` with `donePrompt: true`, so open task pages hide the banner.

## 5. Website

- **Task page:** the banner above the property strip while a prompt is open, following the design kit (SPEC §3: explicit actions, respect permissions; no banner for people who can't edit).
- **Bell:** `TASK_DONE_PROMPT` notifications show the **Mark done** button inline; when the task's last open prompt closes, its prompt notifications are marked read, which removes the button.
- **Activity feed:** automatic moves read "DevTrack automation changed status from … to … · PR #42".

## 6. Delivery

1. This record (docs only).
2. Automatic moves (§1–3): no migration.
3. The prompt (§4–5): migration, API and website.

## 7. Tests

- Each trigger moves forward; nothing moves backwards, out of `BLOCKED`/`DONE`, on deleted tasks, archived projects or imported history.
- Draft opened: no move; marked ready: `IN_REVIEW`. Reopened: `IN_REVIEW`.
- A key from another project's prefix moves nothing; a repo shared by two projects moves only the matching one.
- Retried deliveries and re-pushed commits move nothing twice.
- After a manual move back, a new event moves the task forward again.
- Time in status counts automatic moves.
- Prompt: one per merge, recipients (assignees, else reporter), none when already `DONE`, accept / dismiss / move-to-Done resolution, permissions.

## 8. Linking by hand

Linking an already-open PR to a task in DevTrack only links it; the status stays where it is (user answer). Only GitHub events and Triage move tasks.
