# 0009 — Project Chat and Core UX Upgrade

- **Status:** Accepted (M9)
- **Date:** 2026-11-07
- **Scope:** Milestones M9–M12 — Project chat, persistence, idempotency, read state, mentions, notifications, real-time sync, and core UX improvements

These decisions document the implementation-ready architecture and specifications agreed in `Docs/project-chat-and-ux-plan.md`.

## 1. Outcome and scope

Enable teammates to open a project, exchange messages live, and return later without missing conversations. Improve navigation, board/list views, task details, and notifications while preserving the existing neutral visual identity.

- **Included:** One conversation per project, persistent history, mentions, task links, unread counts, message editing/deletion, reliable retry/reconnect, and responsive, accessible interfaces.
- **Deferred:** Direct messages, support chat, custom channels, attachments, threads, reactions, typing indicators, online presence, search, push/email notifications, and full redesigns.
- **Product rules:**
  - Anyone with existing project access can read its complete chat history.
  - New messages update project unread counts; only direct mentions create bell notifications.
  - Existing task comments remain the home for task-specific discussions.
  - Archived projects retain readable history but reject message creation, editing, and deletion.
  - New users start with zero unread messages when they first open that project's chat.

## 2. Persistence and sequence allocation

- **Tables:**
  - `project_messages`: `id`, `project_id`, `author_id`, `body`, `sequence`, `client_request_id`, `task_id`, `created_at`, `updated_at`, `edited_at`, `deleted_at`.
  - `project_message_mentions`: `message_id`, `mentioned_user_id`.
  - `project_chat_reads`: `project_id`, `user_id`, `last_read_sequence`, `updated_at`.
- **Sequence allocation:**
  - Projects track `next_message_sequence` integer, incremented atomically inside the message creation transaction under an exclusive row lock (`UPDATE projects SET next_message_sequence = next_message_sequence + 1 WHERE id = ... RETURNING next_message_sequence - 1`).
  - This guarantees strict gapless monotonic sequences per project and prevents concurrent sends from committing behind an already acknowledged read position.
- **Idempotency:**
  - Enforced by a unique constraint on `(project_id, author_id, client_request_id)`.
  - If a message with the same `(project_id, author_id, client_request_id)` exists:
    - If `body` and `task_id` match the existing message, the send is an idempotent retry: returns the existing message without incrementing sequence or emitting duplicate mentions/events.
    - If `body` or `task_id` differs, returns `409 Conflict`.
- **Soft deletion:**
  - Sets `deleted_at = now()`.
  - Soft-deleted messages return `body: null`, `deleted: true`, `mentions: []`, `task: null`.
  - Authors may delete their own messages; workspace Admins/Owners may moderate (delete) any message.

## 3. REST interfaces and authorization

All routes use the `/api/v1` prefix:

- `GET /projects/:id/messages`:
  - Default: latest 50 messages.
  - Exclusive sequence pagination: `before=<seq>` or `after=<seq>`.
  - Deep linking: `around=<messageId>` fetches surrounding messages.
- `POST /projects/:id/messages`:
  - Input: `{ body, clientRequestId, taskId? }`.
  - Validates plain text 1–10,000 characters (non-whitespace).
  - Optional task links must belong to the same project.
  - Subject to comment write-rate limit (`RATE_LIMITS.commentCreatePerUser`).
- `PATCH /messages/:id`:
  - Author-only edit of `body` and optional `taskId`.
  - Newly added mentions are notified; removed mentions are detached.
  - Subject to comment write-rate limit.
- `DELETE /messages/:id`:
  - Author or workspace Admin/Owner soft deletion.
- `PUT /projects/:id/chat/read`:
  - Monotonically advances read sequence: `lastReadSequence = GREATEST(last_read_sequence, new_sequence)`.
  - Emits `chat.read` to user's personal room.
- `GET /workspaces/:id/chat/unread`:
  - Returns array of `{ projectId, unreadCount }` for projects the viewer can access.
  - Unread count = non-deleted messages from other authors with `sequence > lastReadSequence`.

## 4. Mentions and notifications

- Reuses existing `parseMentions()` utility (max 20 mentions).
- Resolves only users who currently have access to the project.
- Never notifies the sender.
- Newly added mentions create `MENTIONED` notifications with `resourceType = 'chat_message'`, `resourceId = message.id`, linking to `/projects/:id/chat?message=<id>`.
- Message bodies are strictly excluded from notifications, activity logs, outbox events, and logs.
- Scoped notifications: Chat notification listing, counts, and mark-read operations enforce current project access in addition to workspace membership.

## 5. Real-time events

- Realtime transport delivers identifiers only:
  - `chat.message.created`: to `project:<projectId>`. Payload: `{ messageId, sequence, projectId, actorId }`.
  - `chat.message.updated`: to `project:<projectId>`. Payload: `{ messageId, sequence, projectId }`.
  - `chat.message.deleted`: to `project:<projectId>`. Payload: `{ messageId, sequence, projectId }`.
  - `chat.read`: to `user:<userId>`. Payload: `{ projectId, sequence, userId }`.
- Clients reconcile via REST after reconnect and tab focus.

## 6. UI and Core UX

- Project Chat view (`/projects/[id]/chat`) with scrollable history, date separators, load earlier, bottom composer, mention autocomplete, task selector, and in-memory draft persistence.
- Workspace selector on project routes derives active workspace from loaded project.
- Project navigation tabs scroll horizontally on small viewports.
- Shared filter state between Board and List views via URL query parameters.
- Keyboard-accessible status actions on task board cards.
- Task details screen with visual groupings and "Discuss in chat" deep link.
