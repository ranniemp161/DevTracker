# 0014 — GitHub updates in project chat

- **Status:** Accepted (user answers, 2026-11-20)
- **Date:** 2026-11-20
- **Scope:** Post selected GitHub events as messages in a project's chat, like Slack's GitHub app
- **Builds on:** [0006](0006-github-events.md) (events, delivery processing), [0009](0009-project-chat.md) (chat)

## 1. Outcome

People see what changed in the code where they already talk. GitHub events DevTrack already receives (0006 §5) are also posted to the chat of every project the repository is connected to. Nothing new is fetched from GitHub; this only adds a delivery channel.

## 2. Which events post (approved)

| Key                        | Posts when                                 | On by default       |
| -------------------------- | ------------------------------------------ | ------------------- |
| `pull_request.opened`      | a PR is opened or reopened                 | yes                 |
| `pull_request.merged`      | a PR is merged                             | yes                 |
| `pull_request.closed`      | a PR is closed without merging             | no                  |
| `review.changes_requested` | a review requests changes                  | yes                 |
| `review.approved`          | a review approves                          | no                  |
| `release.published`        | a release is published                     | yes                 |
| `checks.failed`            | CI fails on a PR (arrives with 0015, PR B) | yes, once it exists |

- Stored per project as `projects.chat_github_events text[]`, defaulting to the "yes" rows. Existing projects get the default, so connected projects start receiving updates after deploy.
- Anyone who can manage the project (`viewerCanManage`) changes the list in Project settings, through `PATCH /projects/:id` with `chatGithubEvents`. Unknown keys are rejected (400).
- Pushes, comments-only reviews, edits, synchronizes and draft changes never post: too noisy for chat. They stay in the activity feed.

## 3. Messages (approved)

- A GitHub message is a row in `project_messages` with `kind = 'github'`, `author_id = NULL`, and display details in a new `metadata jsonb` column: event key, repository full name, PR number, title and URL (or release tag, name and URL), and the sender's GitHub login. `body` holds a plain-text summary ("PR #12 opened: Add login page") so search, previews and old clients still work.
- Ordinary messages get `kind = 'user'` (column default) and `metadata = NULL`.
- It is created **inside the delivery's transaction** (0006 §1), right after the activity row, with the same sequence allocation as user messages (0009 §2). A delivery is applied exactly once, so a message is too; a failed delivery rolls back with its message and is retried as a whole.
- `client_request_id` is `github:<random uuid>`. Because `author_id` is NULL, the unique index does not dedupe these rows; the delivery's exactly-once processing (0006 §1) does.
- Only non-archived projects with an active connection receive messages (the same projects that receive the activity, 0006 §4). Archived projects keep earlier messages.
- URLs come from webhook payloads and must be `https://` (0006 §4); the UI renders them as links, never as HTML.

## 4. Unread, push and notifications (approved: user answer 1)

- GitHub messages **count as unread** like any message (they take a sequence number).
- They **never send phone push** (`ChatPushService.enqueue` is not called) and never create bell notifications. The existing PR notifications to assignees of linked tasks (0006) are unchanged.
- The `chat.message.created` realtime event is emitted as usual, so open chats update live.

## 5. Editing and deleting

- Nobody can edit a GitHub message. Workspace Admins/Owners can delete one, like any message (0009 §2 moderation); authors can't, since there is none.

## 6. UI

- Chat renders a GitHub message as a compact event row: GitHub mark, repository, a link with `#number` and title (or the release tag), the sender's login, and the time. No avatar, no Edit/Delete menu except the moderation delete.
- Project settings gets a **GitHub updates in chat** section: one checkbox per event key with a short description, saved with the rest of the form.

## 7. Migration

```sql
ALTER TABLE "project_messages" ADD COLUMN "kind" text DEFAULT 'user' NOT NULL;
ALTER TABLE "project_messages" ADD COLUMN "metadata" jsonb;
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_kind_check" CHECK ("kind" IN ('user', 'github'));
ALTER TABLE "projects" ADD COLUMN "chat_github_events" text[]
  DEFAULT ARRAY['pull_request.opened','pull_request.merged','review.changes_requested','release.published','checks.failed']::text[] NOT NULL;
```

Additive only: existing rows get defaults, nothing is rewritten or dropped. It runs against the shared database only after the user approves the SQL.

## 8. Tests

E2E (in-memory PGlite): one message per enabled event (PR opened, merged, changes requested, release); none for disabled keys, unhandled actions, disconnected repositories or archived projects; a redelivered (duplicate) delivery posts once; GitHub messages count toward unread and enqueue no push; settings validation and permission.
