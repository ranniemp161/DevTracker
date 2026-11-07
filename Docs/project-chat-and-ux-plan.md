# DevTracker: Project Chat and Core UX Upgrade

**Status:** Implementation-ready proposal; implementation has not started.
**Date:** 2026-11-07
**Audience:** Engineers implementing and reviewing the next release.

## 1. Outcome and agreed scope

Enable two teammates to open a project, exchange messages live, and return later without missing conversations. Improve navigation, board/list views, task details, and notifications while preserving the existing neutral visual identity.

**Included:** one conversation per project, persistent history, mentions, task links, unread counts, message editing/deletion, reliable retry/reconnect, and responsive, accessible interfaces.

**Deferred:** direct messages, support chat, custom channels, attachments, threads, reactions, typing indicators, online presence, search, push/email notifications, and a full visual redesign.

Product decisions:

- Anyone with existing project access can read its complete chat history.
- New messages update project unread counts; only direct mentions create bell notifications.
- Existing task comments remain the home for task-specific discussions.
- Archived projects retain readable history but reject message creation, editing, and deletion.
- New users start with zero unread messages when they first open that project's chat.

## 2. Architecture and application contracts

### Build on the current foundation

Retain NestJS REST writes, PostgreSQL/Drizzle persistence, the transactional outbox, and authenticated Socket.IO delivery. The standalone realtime service remains a transport service.

Events contain identifiers only. Clients fetch authorized content through REST. Message bodies must not appear in socket events, activity metadata, or application logs.

### Persistence

Add:

- **Project messages:** project, author, plain-text body, server-assigned project sequence, client request ID, creation/edit/deletion timestamps, and optional linked task.
- **Message mentions:** message-to-user associations using existing mention parsing and project visibility rules.
- **Chat read state:** one row per project/user, recording the highest acknowledged sequence.

Allocate message sequences under a per-project transactional lock so concurrent sends cannot commit behind an already acknowledged read position. Use sequences for pagination and read tracking.

Enforce a unique `(project, author, client request ID)` constraint. Retrying a successful send returns the existing message without duplicating mentions or outbox events. Reusing the request ID with different content returns a conflict.

Soft-deleted messages render a placeholder without body, mentions, or task details. Retain chat history under the existing product-history retention policy.

### REST interfaces

All routes use the existing `/api/v1` prefix, envelopes, authentication, and validation conventions.

| Endpoint                          | Behavior                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /projects/:id/messages`      | Latest 50 messages by default; support exclusive `before` or `after` sequence pagination and an `around` message ID for deep links |
| `POST /projects/:id/messages`     | Create using `{ body, clientRequestId, taskId? }`                                                                                  |
| `PATCH /messages/:id`             | Author-only edit of body and optional task link                                                                                    |
| `DELETE /messages/:id`            | Author or workspace Admin/Owner soft deletion                                                                                      |
| `PUT /projects/:id/chat/read`     | Monotonically advance read position through an acknowledged sequence                                                               |
| `GET /workspaces/:id/chat/unread` | Return unread counts for projects the viewer can access                                                                            |

Publish matching message, page, read-state, and unread-summary types in the shared types package; place request validators in the shared validators package.

Rules:

- Plain text, 1–10,000 characters; reject whitespace-only messages.
- Reuse the existing maximum of 20 resolved mentions.
- Resolve mentions only for users with current project access; never notify the sender.
- On edits, notify newly added mentions only.
- Optional task links must reference a live task in the same project. Unavailable tasks render a neutral placeholder.
- Apply the existing comment write-rate policy to chat creation and editing.
- Inaccessible resources return `404`; every read and write rechecks access.
- Writes, mention records, notifications, and outbox entries commit atomically.

### Unread state and notifications

- Count non-deleted messages from other authors beyond the user's read position.
- Editing messages does not create unread messages.
- First opening chat initializes its read position through the latest returned message; earlier history remains available.
- Advance read state only while chat is visible and the user has reached the newest displayed message. Never acknowledge messages that arrived after the displayed snapshot.
- Merge read positions monotonically across tabs and devices.
- Reuse `MENTIONED` notifications with a chat-message resource and link to `/projects/:id/chat?message=<id>`.
- Chat notification listing, counts, and mark-read operations must enforce current project access, beyond the existing workspace visibility check.
- Bell-read state and chat-read state remain separate.

### Real-time behavior

Add `chat.message.created`, `chat.message.updated`, and `chat.message.deleted` events to project rooms. Send `chat.read` to the reader's personal room.

The website must:

- Merge messages by ID and order by server sequence.
- Reconcile persisted messages and unread counts after reconnect and tab focus.
- Refresh loaded history after update/delete hints.
- Refresh unread summaries periodically on project-list screens rather than subscribing to every project.
- Show a connection-status indicator and poll visible chat every 15 seconds while disconnected.
- Allow REST sends while sockets are disconnected; failed sends require explicit retry.
- Clear displayed chat data when REST reports access loss.

## 3. UI/UX specification

### Navigation and visual consistency

Keep the existing top navigation and project tabs. Add **Chat** with an unread badge, plus chat badges on project-list entries.

Fix workspace selection on project routes: derive the workspace from the loaded project rather than treating the project ID as a workspace ID.

Preserve the light neutral palette and system font. Standardize spacing, buttons, fields, focus indicators, skeletons, empty states, and inline retry messages through existing components. Allow board/list pages more horizontal space while keeping forms comfortably readable.

Make project tabs horizontally scrollable on small screens without overflowing the page.

### Chat screen

- Full project page with scrollable history and a bottom composer.
- Latest messages initially; “Load earlier” preserves scroll position.
- Display author, timestamp, edited indicator, and date separators.
- Enter sends; Shift+Enter adds a line break; composition input must not accidentally send.
- Include accessible mention suggestions and an optional same-project task selector.
- Show optimistic messages as **Sending**, then confirmed or **Failed—Retry**.
- Retry uses the original client request ID.
- Keep drafts in memory per project during the signed-in session; clear on logout.
- Scroll automatically only when already near the bottom or after the user sends.
- Otherwise show a “New messages” button.
- Deep links load surrounding history and highlight the target, with clear unavailable/deleted states.
- Edit controls preserve text on failure; deletion requires confirmation.

### Core workflows

- **Board/list:** share filters for status, priority, assignee, and label; preserve filters in the URL and when switching views.
- **Board:** retain drag-and-drop and add a keyboard/touch-accessible status action.
- **Task creation:** keep quick creation visible and retain entered values after failed saves.
- **Task details:** retain the existing route and explicit Save action; improve grouping of details, assignees, comments, and history. Add a “Discuss in chat” link that opens the composer with the task selected.
- **Notifications:** improve unread distinction, loading/error/empty states, and navigation to the exact mentioned message.
- **Accessibility:** visible keyboard focus, labelled controls, text equivalents for status colors, restrained live announcements, reduced-motion support, and usable layouts at 360px, 768px, and desktop widths.

## 4. Implementation sequence and verification

Implement and review each milestone before starting the next.

| Milestone                          | Deliverables and completion gate                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M9 — Contracts and persistence** | Document decisions; add migration, shared contracts, authorization, message CRUD, idempotency, mentions, and read state. API integration tests pass.                    |
| **M10 — Live project chat**        | Add chat page, composer, history, deep links, outbox events, unread badges, and reconnect reconciliation. Two isolated browser sessions exchange messages successfully. |
| **M11 — Core UX improvements**     | Implement navigation fixes, shared filters, accessible task actions, task-detail grouping, and notification states. Complete responsive and keyboard review.            |
| **M12 — Release acceptance**       | Run repository checks and production acceptance, record evidence, and update deployment/handoff documentation.                                                          |

Required automated scenarios:

- Member, Admin/Owner, outsider, removed member, unverified user, and archived-project access.
- Transaction rollback leaves no message, mention notification, or outbox residue.
- Duplicate/concurrent retries create exactly one message.
- Concurrent sends and read updates cannot skip unread messages.
- Pagination, first-open initialization, deletion, self-messages, and multi-tab read state.
- Mention edits, self-mention suppression, task-link validation, and revoked-access notification filtering.
- Duplicate/out-of-order events, reconnect gaps, failed REST sends, and inaccessible deep links.
- Regression coverage for comments, task updates, notifications, and GitHub-linked task behavior.

Use existing API/PGlite and realtime test infrastructure. Add Playwright browser coverage for the two-user chat flow, retry behavior, unread state, and keyboard task actions against isolated test data.

Run formatting checks, lint, typecheck, tests, and production builds. Record screenshots and keyboard-review results for the three target widths.

## 5. Rollout, documentation, and acceptance

This document preserves the agreed plan for a later implementation session. No implementation, migration, or deployment is authorized by saving it.

During implementation, record chat decisions in `Docs/decisions/0009-project-chat.md`, then update the architecture, release checklist, and handoff references.

Use additive migrations: deploy schema and backward-compatible API support before the website. Apply migrations to development/test first. Production migration and deployment remain separately authorized actions.

At planning time, the repository documents a recent realtime publisher fix with production verification pending. Before releasing chat, verify that the deployed API contains the fix and that valid-user events reach a second signed-in browser through Redis. Do not treat an unauthenticated socket probe as acceptance.

Release acceptance requires:

- A second browser receives a saved message without manual refresh within a five-second healthy-network test window.
- Reconnection recovers all persisted messages without duplicates.
- Returning users see accurate unread counts and can reach mentioned messages.
- Revoked users cannot fetch chat content or chat notifications.
- Existing project/task workflows remain usable on mobile and with a keyboard.
- Outbox backlog, API errors, and reconnect failures are observable without recording message content.

If acceptance fails, roll back the website/API release while retaining the additive schema and saved messages. Do not delete chat history as part of rollback.
