# DevTrack — MVP Architecture & Engineering Overview

**Document status:** Architecture baseline for MVP implementation  
**Version:** 1.6 (M1–M6 decisions recorded; see `Docs/decisions/`)  
**Last updated:** 2026-11-06  
**Purpose:** Give Claude and other engineering agents a self-contained overview of the DevTrack product, architecture, constraints, and implementation plan.

---

## 1. Product overview

DevTrack is an internal engineering project management platform with first-class GitHub integration.

Its purpose is to help software teams plan and assign work, collaborate around tasks, and automatically surface development activity from GitHub. The platform should reduce manual status reporting by connecting project tasks to actual commits, pull requests, reviews, and releases.

### Primary users

- Workspace owners
- Workspace administrators
- Engineering team members / developers

This is an **internal team product**, not a general-purpose client portal in the MVP.

### Core workflow

1. An administrator creates a workspace.
2. The administrator invites team members by email.
3. The team creates a project and adds project members.
4. The team creates tasks and assigns developers.
5. An administrator installs the DevTrack GitHub App and selects repositories.
6. Selected repositories are connected to projects.
7. Developers push commits and open pull requests in GitHub.
8. DevTrack receives GitHub webhooks and records relevant activity.
9. Pull requests can be linked to tasks.
10. Team members see project, task, comment, and GitHub activity updates.

### Product principles

1. **Development visibility:** Surface real development activity without requiring manual reporting for every event.
2. **Single source of truth:** DevTrack owns project/task workflow; GitHub owns source code and pull request state.
3. **Real-time collaboration:** Relevant updates should appear without a manual page refresh.
4. **Modular architecture:** Keep the application maintainable as features expand.
5. **Least privilege:** Only access GitHub repositories explicitly selected by workspace administrators.

---

## 2. Confirmed product and architecture decisions

| Concern | Decision |
|---|---|
| Product audience | Internal engineering teams |
| Frontend | Next.js |
| Backend | NestJS |
| Language | TypeScript |
| Monorepo | Turborepo |
| Package manager | pnpm |
| ORM | Drizzle ORM |
| Database | Neon PostgreSQL |
| Authentication | Email/password plus GitHub OAuth login |
| GitHub repository integration | GitHub App |
| Repository access | Explicitly selected repositories |
| API style | REST |
| Real-time scope | Task updates, comments, notifications, and activity |
| Real-time protocol | Socket.IO / WebSocket |
| Deployment preference | Vercel for frontend and backend |
| Backend architecture | Modular monolith |
| Comments | Included in MVP |
| Full chat | Excluded from MVP |

### Important distinction: GitHub OAuth vs GitHub App

These are separate integrations:

- **GitHub OAuth** authenticates a person into DevTrack.
- **GitHub App** grants DevTrack installation-level access to selected repositories and delivers webhooks.

Logging in with GitHub must not automatically grant repository access. GitHub App installation and repository selection are explicit administrator actions.

---

## 3. High-level architecture

```text
                         ┌──────────────────────────┐
                         │       Team Members       │
                         │       Web Browser        │
                         └────────────┬─────────────┘
                                      │
                           HTTPS / Socket.IO
                                      │
                  ┌───────────────────┴──────────────────┐
                  │                                      │
        ┌─────────▼─────────┐                 ┌──────────▼─────────┐
        │   Next.js Web     │                 │  Real-time client  │
        │   Vercel          │                 │  Socket.IO         │
        └─────────┬─────────┘                 └──────────┬─────────┘
                  │                                      │
                  └───────────────────┬──────────────────┘
                                      │
                            ┌─────────▼─────────┐
                            │    NestJS API     │
                            │      Vercel       │
                            │                   │
                            │ Auth / RBAC       │
                            │ Business modules  │
                            │ GitHub webhooks   │
                            │ Event publishing  │
                            └───┬───────────┬───┘
                                │           │
                    ┌───────────▼───┐   ┌───▼─────────────┐
                    │ Neon          │   │ Redis           │
                    │ PostgreSQL    │   │ Cross-instance  │
                    │ Durable state │   │ event adapter   │
                    └───────────────┘   └─────────────────┘
                                ▲
                                │ Webhooks / GitHub API
                       ┌────────┴────────┐
                       │    GitHub App   │
                       │ Repositories    │
                       │ Commits / PRs   │
                       │ Reviews         │
                       │ Releases        │
                       └─────────────────┘
```

### Responsibilities

**Next.js**
- User interface and navigation.
- Workspace, project, task, and activity screens.
- Client-side state and data fetching.
- Socket.IO client connection and event handling.
- No direct database access.

**NestJS**
- Authentication and session management.
- Authorization and workspace isolation.
- Business logic and REST API.
- Database access through Drizzle.
- GitHub App integration and webhook processing.
- Durable event creation and real-time event publishing.

**Neon PostgreSQL**
- Source of truth for users, workspaces, projects, tasks, comments, GitHub metadata, activity, notifications, webhook delivery records, and outbox events.

**Redis**
- Cross-instance Socket.IO event distribution and any justified short-lived coordination.
- Not the source of truth.
- Do not store durable tasks, comments, notifications, or activity only in Redis.

**GitHub**
- Source of truth for repositories, source code, commits, pull requests, reviews, and releases.

---

## 4. Deployment architecture and WebSocket constraints

The deployment preference is Vercel for both Next.js and NestJS. This must be implemented with awareness of serverless execution and connection lifecycle constraints.

### Deployment components

| Component | Initial platform |
|---|---|
| Next.js frontend | Vercel |
| NestJS API | Vercel Functions, subject to compatibility validation |
| PostgreSQL | Neon |
| Redis | Managed Redis provider |
| GitHub integration | GitHub App |
| Transactional email | Provider to be selected |
| Error tracking | Provider to be selected |

### WebSocket design

Do not assume a Vercel Function behaves like a permanently running VPS process. Validate the current Vercel WebSocket support, runtime requirements, function duration, connection lifecycle, and Socket.IO compatibility before implementation.

The application must not depend on one function instance retaining connection state.

Requirements:
- Use an external Socket.IO adapter / shared event transport when multiple instances are involved.
- Redis may provide cross-instance Socket.IO event distribution.
- Authenticate every socket connection.
- Authorize all workspace/project room subscriptions on the server.
- Reconnect with backoff.
- Reauthenticate and rejoin authorized rooms after reconnect.
- Re-fetch or reconcile state after reconnect because socket events are not guaranteed durable delivery.
- Never rely on in-memory state for durable business information.

If Vercel's current runtime or deployment model does not support the required persistent Socket.IO behavior reliably, use a managed real-time provider (for example, Ably or Pusher) behind an application-level real-time interface, or deploy the persistent NestJS real-time gateway to a suitable long-running host. This is a deployment decision, not a reason to couple business logic to a provider.

### Recommended real-time abstraction

Define an application interface such as:

```ts
interface RealtimePublisher {
  publishToProject(projectId: string, event: RealtimeEvent): Promise<void>;
  publishToWorkspace(workspaceId: string, event: RealtimeEvent): Promise<void>;
  publishToUser(userId: string, event: RealtimeEvent): Promise<void>;
}
```

Business modules should depend on this abstraction, not directly on Redis, Socket.IO, Ably, or Pusher.

---

## 5. Authentication and identity

### Supported authentication methods

1. Email and password.
2. GitHub OAuth login.

### Requirements

- Unique normalized email address.
- Unique username.
- Secure password hashing using Argon2id.
- Email verification before protected workspace use.
- Secure session handling.
- HTTP-only, Secure, SameSite cookies where appropriate.
- Session revocation and logout.
- Password reset flow.
- OAuth state validation and secure callback handling.
- Prevent account-linking vulnerabilities when linking GitHub identity to an existing email account.

### Authentication tables

**users**
- `id` UUID primary key
- `email` unique
- `username` unique
- `password_hash` nullable for OAuth-only account creation
- `email_verified_at`
- `avatar_url`
- `created_at`
- `updated_at`

**accounts**
- `id`
- `user_id` foreign key
- `provider` (e.g. `github`)
- `provider_account_id`
- `created_at`
- Unique `(provider, provider_account_id)`

**sessions**
- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `created_at`

Store session token hashes, not raw session tokens.

**Approved M1 additions** (decision record 0001):
- `email_verification_tokens`: `user_id`, `email` (the address the token was sent to), `token_hash` unique, `expires_at` (24 h), `consumed_at`.
- `password_reset_tokens`: `user_id`, `token_hash` unique, `expires_at` (1 h), `consumed_at`.
- `oauth_states`: `provider`, `state_hash` unique, `code_verifier` (PKCE), `redirect_to`, `expires_at` (10 min). Deleted when used.
- `rate_limit_buckets`: `key` (hashed), `count`, `window_started_at`. Fixed-window counters shared across serverless instances.

Session implementation: opaque 256-bit tokens in an HTTP-only `SameSite=Lax` cookie (`Secure` with the `__Host-` prefix over HTTPS), with a fixed 30-day lifetime, revocable by deleting the row. The browser reaches the API same-origin through the website's `/api/v1` rewrite.

---

## 6. Workspace and authorization model

DevTrack is multi-tenant from the beginning.

A user can belong to multiple workspaces. Projects belong to exactly one workspace. Workspace membership is the root authorization boundary.

### Workspace roles

| Role | Permissions |
|---|---|
| Owner | Full workspace control, including ownership-sensitive operations |
| Admin | Manage workspace, members, invitations, projects, and GitHub integration |
| Member | Access assigned projects and collaborate within granted permissions |

Project membership further scopes access to project resources.

### Authorization rules

- The backend is authoritative for all authorization.
- Never trust a workspace ID, project ID, or room name supplied by the browser without checking membership.
- Every resource lookup must verify that the authenticated user has access through the relevant workspace/project relationship.
- Prevent insecure direct object reference (IDOR) and cross-workspace access.
- A user must not gain access merely by guessing a UUID.
- Socket.IO room joins must be authorized server-side.
- GitHub installation administration is restricted to authorized workspace administrators/owners.

### Approved M2 role rules

The full permission matrix is in `Docs/decisions/0002-workspaces-membership-invitations.md`. In summary: exactly one Owner, who cannot be removed, demoted or leave (no ownership transfer in the MVP); Admins can invite Admins or Members but can only change or remove Members; non-members get 404 for every workspace resource.

### Invitations

Invitation properties:
- Workspace ID
- Email
- Assigned role
- Inviter
- Hashed random token
- Expiration
- Accepted timestamp
- Revoked timestamp

Requirements:
- Default expiration: seven days.
- Single use.
- Store token hash, not plaintext.
- Revocable by authorized administrators.
- Existing users can accept without creating another account.
- Invitation does not grant access until accepted.
- Rate-limit invitation creation and acceptance attempts.

---

## 7. Functional modules and MVP scope

### 7.1 Workspace management

- Create and update workspace.
- List workspaces the user belongs to.
- Manage workspace members.
- Invite members by email.
- Accept/revoke invitations.
- Change member roles.
- Remove members, subject to owner protections.

### 7.2 Project management

A project contains:
- Name and description.
- Unique project key within workspace (e.g. `DEV`).
- Status.
- Start date and target date.
- Creator.
- Project members.
- Connected GitHub repositories.
- Tasks and milestones.
- Activity feed.

Project statuses:
- `PLANNING`
- `ACTIVE`
- `ON_HOLD`
- `COMPLETED`
- `ARCHIVED`

### 7.3 Task management

Task properties:
- Internal UUID.
- Project ID.
- Sequential task number.
- Human-readable task key (e.g. `DEV-104`).
- Title.
- Description.
- Status.
- Priority.
- Reporter.
- Assignees (many-to-many).
- Due date.
- Labels.
- Created/updated timestamps.
- Completed timestamp.

Task statuses:
- `BACKLOG`
- `TODO`
- `IN_PROGRESS`
- `IN_REVIEW`
- `DONE`
- `BLOCKED`

Priorities:
- `LOW`
- `MEDIUM`
- `HIGH`
- `URGENT`

Views:
- Kanban.
- List.
- Task detail.

Task numbers must be allocated safely under concurrent creation and never reused. Use a transaction and an appropriate database-backed counter/locking strategy rather than calculating `MAX(task_number) + 1` without protection.

Task changes that matter should create activity records.

### 7.4 Comments and mentions

MVP functionality:
- Create comments on tasks.
- Edit own comments.
- Delete own comments (soft deletion is preferred).
- Admin moderation according to policy.
- Mention members using `@username`.
- Notify mentioned users.
- Display author and timestamps.

Out of scope:
- Full chat.
- Threaded replies.
- Attachments.
- Reactions.

### 7.5 GitHub integration

- Install the DevTrack GitHub App.
- Store installation metadata.
- List repositories available to the installation.
- Allow authorized administrators to select repositories.
- Connect selected repositories to projects.
- Synchronize repository metadata.
- Receive and process webhook events.
- Store commits, pull requests, reviews, and releases.
- Link pull requests to tasks manually.
- Optionally detect task references in branch names/PR text as a convenience.
- Preserve historical records when a repository is disconnected, subject to retention policy.

GitHub events must not automatically mark tasks as `DONE`. GitHub activity updates development metadata and activity; task workflow remains explicitly controlled by the team.

### 7.6 Activity feed

Show relevant user and GitHub activity chronologically, scoped to project/workspace permissions.

Examples:
- Task created or updated.
- Assignee changed.
- Comment posted.
- Pull request opened or merged.
- Commit pushed.
- Review submitted.
- Release published.

### 7.7 Notifications

MVP notification types:
- Task assigned.
- User mentioned.
- Comment received.
- Pull request opened.
- Pull request merged.
- Pull request reviewed.
- Milestone completed.

Users can:
- List notifications.
- Read one notification.
- Mark all as read.
- Retrieve unread count.

---

## 8. Logical database schema

Use PostgreSQL with Drizzle ORM. The list below is the logical model; exact Drizzle column definitions, indexes, constraints, enums, and migrations are implementation deliverables.

### 8.1 Tables

#### Identity
- `users`
- `accounts`
- `sessions`
- `email_verification_tokens` (M1)
- `password_reset_tokens` (M1)
- `oauth_states` (M1)

#### Platform
- `rate_limit_buckets` (M1)

#### Workspace
- `workspaces`
- `workspace_members`
- `invitations`

#### Project
- `projects`
- `project_members`
- `milestones`

#### Task
- `tasks`
- `task_assignees`
- `labels`
- `task_labels`

#### Collaboration
- `comments`
- `comment_mentions`

#### GitHub
- `github_installations`
- `github_repositories`
- `project_repositories`
- `github_pull_requests`
- `github_commits`
- `github_reviews`
- `task_github_links`
- `github_install_states` (M5 addition: pending installation flows, see decision record 0005)

#### Activity and reliability
- `activity_logs`
- `notifications`
- `github_webhook_deliveries`
- `outbox_events`

### 8.2 Important table fields and constraints

**workspaces**
- `id` UUID PK
- `name`
- `slug` unique
- `owner_id` FK to users
- `archived_at` nullable (M2: DELETE archives)
- One OWNER membership per workspace, enforced by a partial unique index (M2)
- timestamps

**workspace_members**
- `id`
- `workspace_id` FK
- `user_id` FK
- `role`
- `joined_at`
- Unique `(workspace_id, user_id)`

**invitations**
- `id`
- `workspace_id` FK
- `email`
- `role`
- `token_hash` unique
- `invited_by` FK
- `expires_at`
- `accepted_at` nullable
- `revoked_at` nullable
- `role` can never be OWNER (CHECK constraint); at most one open invitation per (workspace, email) (M2)

**projects**
- `id`
- `workspace_id` FK
- `name`
- `key`
- `description`
- `status`
- `start_date`
- `target_date`
- `created_by` FK
- timestamps
- Unique `(workspace_id, key)`
- `next_task_number` (M3): per-project counter for safe task-number allocation

**project_members**
- `id`
- `project_id` FK
- `user_id` FK
- `created_at`
- Unique `(project_id, user_id)`

**tasks**
- `id`
- `project_id` FK
- `task_number`
- `title`
- `description`
- `status`
- `priority`
- `reporter_id` FK
- `due_date`
- timestamps
- `completed_at`
- `deleted_at` nullable (M3: soft deletion)
- Unique `(project_id, task_number)`

**task_assignees**
- `task_id` FK
- `user_id` FK
- `assigned_at`
- Composite PK `(task_id, user_id)`

**comments**
- `id`
- `task_id` FK
- `author_id` FK
- `body`
- `created_at`
- `updated_at`
- `deleted_at` nullable

**comment_mentions**
- `comment_id` FK
- `mentioned_user_id` FK
- Composite PK `(comment_id, mentioned_user_id)`

**labels**
- `id`
- `workspace_id` FK
- `name`
- `color`

**task_labels**
- `task_id` FK
- `label_id` FK
- Composite PK `(task_id, label_id)`

**milestones**
- `id`
- `project_id` FK
- `name`
- `description`
- `due_date`
- `status`

**github_installations**
- `id` UUID PK
- `workspace_id` FK
- `github_installation_id` BIGINT unique
- `account_login`
- `account_type`
- `status`
- `installed_at`
- `suspended_at`

**github_repositories**
- `id` UUID PK
- `installation_id` FK
- `github_repository_id` BIGINT
- `full_name`
- `owner_login`
- `default_branch`
- `visibility`
- `connected_at`
- `disconnected_at`
- Unique `(installation_id, github_repository_id)`

**project_repositories**
- `project_id` FK
- `repository_id` FK
- `connected_by` FK
- `connected_at`
- Composite PK `(project_id, repository_id)`

**github_pull_requests**
- `id` UUID PK
- `repository_id` FK
- `github_pr_id` BIGINT
- `number`
- `title`
- `url`
- `author_login`
- `head_branch`
- `base_branch`
- `state`
- `is_draft`
- `merged_at`
- `created_at`
- `updated_at`
- Unique `(repository_id, github_pr_id)`

**github_commits**
- `id` UUID PK
- `repository_id` FK
- `sha`
- `message`
- `author_login`
- `committed_at`
- Unique `(repository_id, sha)`

**github_reviews**
- `id` UUID PK
- `pull_request_id` FK
- `github_review_id` BIGINT
- `reviewer_login`
- `state`
- `submitted_at`
- Unique `(pull_request_id, github_review_id)`

**task_github_links**
- `task_id` FK
- `pull_request_id` FK
- `linked_by` FK
- `created_at`
- Composite PK `(task_id, pull_request_id)`

**activity_logs**
- `id`
- `workspace_id` FK
- `project_id` FK nullable
- `actor_id` FK nullable (GitHub system events may have no DevTrack user actor)
- `entity_type`
- `entity_id`
- `action`
- `metadata` JSONB
- `created_at`

**notifications**
- `id`
- `user_id` FK
- `workspace_id` FK
- `type`
- `title`
- `body`
- `resource_type`
- `resource_id`
- `read_at`
- `created_at`

**github_webhook_deliveries**
- `id`
- `delivery_id` unique
- `event_type`
- `installation_id` nullable
- `repository_id` nullable
- `payload` JSONB
- `processing_status`
- `received_at`
- `processed_at`
- `error_message`

**outbox_events**
- `id`
- `event_type`
- `aggregate_id`
- `payload` JSONB
- `created_at`
- `published_at`
- `attempts`

### 8.3 Relationship summary

```text
User ──< WorkspaceMember >── Workspace
Workspace ──< Project
Project ──< ProjectMember >── User
Project ──< Task
Task ──< TaskAssignee >── User
Task ──< Comment
Comment ──< CommentMention >── User
Project ──< ProjectRepository >── GitHubRepository
GitHubInstallation ──< GitHubRepository
GitHubRepository ──< GitHubPullRequest
GitHubRepository ──< GitHubCommit
GitHubPullRequest ──< GitHubReview
Task ──< TaskGitHubLink >── GitHubPullRequest
User ──< Notification
Workspace/Project ──< ActivityLog
```

### 8.4 Data integrity and indexing

- Use foreign keys and appropriate delete behavior.
- Use unique constraints for external GitHub identifiers.
- Use transactions for multi-table business operations.
- Index workspace, project, task status, assignee, and time-based activity queries.
- Use cursor pagination for large lists and feeds.
- Use composite indexes for common workspace-scoped access patterns.
- Enforce task number allocation safely under concurrent writes.
- Consider composite foreign keys or equivalent service-level constraints to prevent linking resources across different workspaces.
- Use soft deletion selectively; document retention behavior.
- Do not store secrets or access tokens in activity metadata.

---

## 9. REST API specification

Base path:

```text
/api/v1
```

### Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Register |
| POST | `/auth/login` | Email/password login |
| POST | `/auth/logout` | End session |
| GET | `/auth/me` | Current user |
| GET | `/auth/github` | Begin GitHub OAuth |
| GET | `/auth/github/callback` | OAuth callback |
| POST | `/auth/verify-email` | Verify email |
| POST | `/auth/resend-verification` | Resend verification email (M1 addition) |
| POST | `/auth/forgot-password` | Request reset |
| POST | `/auth/reset-password` | Reset password |
| GET | `/health` | Health check, including database connectivity (M1 addition) |

### Workspaces and invitations

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/workspaces` | Create workspace |
| GET | `/workspaces` | List user's workspaces |
| GET | `/workspaces/:id` | Workspace details |
| PATCH | `/workspaces/:id` | Update workspace |
| DELETE | `/workspaces/:id` | Archive workspace (owner only; M2 policy, see decision record 0002) |
| GET | `/workspaces/:id/members` | List members |
| PATCH | `/workspaces/:id/members/:userId` | Change role |
| DELETE | `/workspaces/:id/members/:userId` | Remove member |
| POST | `/workspaces/:id/invitations` | Invite member |
| GET | `/workspaces/:id/invitations` | List invitations |
| POST | `/invitations/accept` | Accept invitation |
| POST | `/invitations/:id/revoke` | Revoke invitation |

### Projects

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/workspaces/:id/projects` | Create project |
| GET | `/workspaces/:id/projects` | List projects |
| GET | `/projects/:id` | Project details |
| PATCH | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Archive project |
| GET | `/projects/:id/members` | List project members |
| POST | `/projects/:id/members` | Add member |
| DELETE | `/projects/:id/members/:userId` | Remove member |

### Tasks

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/projects/:id/tasks` | Create task |
| GET | `/projects/:id/tasks` | List tasks |
| GET | `/tasks/:id` | Task details |
| PATCH | `/tasks/:id` | Update task |
| DELETE | `/tasks/:id` | Delete/archive task |
| PATCH | `/tasks/:id/status` | Change status |
| POST | `/tasks/:id/assignees` | Assign users |
| DELETE | `/tasks/:id/assignees/:userId` | Remove assignee |
| POST | `/tasks/:id/labels` | Attach label |
| DELETE | `/tasks/:id/labels/:labelId` | Remove label |

### Comments

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/tasks/:id/comments` | Create comment |
| GET | `/tasks/:id/comments` | List comments |
| PATCH | `/comments/:id` | Edit comment |
| DELETE | `/comments/:id` | Delete comment |

### GitHub

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/github/install` | Start GitHub App installation (`?workspaceId=`; browser redirect) |
| GET | `/github/install/callback` | Complete installation callback |
| GET | `/github/installations` | List workspace installations (`?workspaceId=`; returns `{ appConfigured, installations }`, M5) |
| GET | `/github/installations/:id/repositories` | List available repositories |
| POST | `/projects/:id/repositories` | Connect selected repository |
| GET | `/projects/:id/repositories` | List connected repositories |
| DELETE | `/projects/:id/repositories/:repoId` | Disconnect repository |
| GET | `/projects/:id/github/activity` | GitHub activity |
| GET | `/repositories/:id/pull-requests` | List PRs |
| POST | `/tasks/:id/pull-requests` | Link PR to task |
| DELETE | `/tasks/:id/pull-requests/:prId` | Unlink PR |
| GET | `/tasks/:id/pull-requests` | Linked PRs of a task (M6 addition) |
| GET | `/internal/github/deliveries/retry` | Scheduled retry of failed webhook deliveries (bearer `CRON_SECRET`; M6 addition) |

Public GitHub webhook endpoint:

```http
POST /api/v1/webhooks/github
```

This endpoint uses GitHub HMAC signature verification rather than user session authentication.

### Activity and notifications

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/projects/:id/activity` | Project activity (optional `?taskId=` for one task's history; M4 addition) |
| GET | `/notifications` | List notifications |
| GET | `/notifications/unread-count` | Unread count |
| PATCH | `/notifications/:id/read` | Mark one as read |
| POST | `/notifications/read-all` | Mark all as read |

### API conventions

Validation errors may also include `error.details: [{ path, message }]` (M1 addition).

Successful response:

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid"
  }
}
```

Paginated response:

```json
{
  "data": [],
  "meta": {
    "nextCursor": "opaque-cursor",
    "hasMore": true
  }
}
```

Error response:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this resource.",
    "requestId": "uuid"
  }
}
```

Use consistent HTTP status codes, error codes, centralized exception handling, request IDs, validation, and cursor pagination.

---

## 10. WebSocket / real-time specification

### Purpose

Real-time transport delivers updates. PostgreSQL remains the source of truth.

### Proposed Socket.IO namespace and rooms

Connection URL (deployment-specific):

```text
wss://api.example.com/socket.io/
```

Logical rooms:

```text
workspace:{workspaceId}
project:{projectId}
user:{userId}
```

The server must authorize every room join. A client must never be able to subscribe to an arbitrary room merely by supplying its name.

### Server-to-client events

| Event | Purpose |
|---|---|
| `task.created` | New task |
| `task.updated` | Task changed |
| `task.deleted` | Task removed |
| `task.assigned` | Assignment changed |
| `comment.created` | New comment |
| `comment.updated` | Comment edited |
| `comment.deleted` | Comment deleted |
| `github.pull_request.updated` | PR state/details changed |
| `github.commit.received` | Commit recorded |
| `github.review.submitted` | Review recorded |
| `activity.created` | Activity feed entry |
| `notification.created` | New notification |
| `notification.read` | Read state changed |

### Event envelope

```json
{
  "id": "event-uuid",
  "type": "task.updated",
  "version": 1,
  "occurredAt": "2026-11-06T00:00:00.000Z",
  "workspaceId": "workspace-uuid",
  "projectId": "project-uuid",
  "actor": {
    "id": "user-uuid"
  },
  "entity": {
    "type": "task",
    "id": "task-uuid"
  },
  "payload": {
    "status": "IN_REVIEW"
  }
}
```

Do not broadcast sensitive data or full private records to broad rooms. Payloads should contain only the information authorized subscribers need.

### Reliable event delivery pattern

```text
User action or GitHub webhook
          |
          v
NestJS validates and authorizes
          |
          v
Database transaction
  - persist business data
  - create activity/notification
  - insert outbox event
          |
          v
Outbox publisher
          |
          v
Redis / real-time adapter
          |
          v
Authorized Socket.IO rooms
          |
          v
Connected clients
```

The business update and outbox event should be committed in the same database transaction. A publisher processes unpublished outbox rows and marks them published after successful dispatch. Retries must be safe.

### Reconnection and consistency

- Reconnect with exponential backoff.
- Reauthenticate after reconnect.
- Reauthorize and rejoin rooms.
- Fetch latest state or missed activity after reconnect.
- Reconcile client state with PostgreSQL-backed API results.
- Use event IDs for deduplication.
- Do not assume exactly-once WebSocket delivery.

---

## 11. GitHub App integration

### 11.1 Permissions

Request least-privilege permissions. Initial expected permissions:

| Permission | Access |
|---|---|
| Metadata | Read |
| Contents | Read, if required for the selected commit/repository API operations |
| Pull requests | Read |

Validate the exact permissions against the GitHub endpoints and webhook subscriptions actually used. Do not request write access for the MVP.

### 11.2 Installation lifecycle

1. Workspace administrator starts GitHub App installation.
2. GitHub redirects through the installation callback.
3. Backend validates callback/state and records installation metadata.
4. Backend obtains the accessible repository list using the installation.
5. Administrator explicitly selects repositories.
6. Selected repositories are connected to projects.
7. Webhooks update repository/PR/commit/review/release metadata.

An installation may cover multiple repositories, but DevTrack should only ingest project activity for repositories explicitly connected to a project. Installation lifecycle events still need to be processed so access changes and suspension/removal are recognized.

### 11.3 Repository selection

Store:
- GitHub installation ID.
- GitHub repository ID.
- Owner/login.
- Repository full name.
- Default branch.
- Visibility.
- Connection status and timestamps.

Use GitHub numeric IDs as stable external identifiers; repository names can change.

### 11.4 Webhook endpoint and headers

```http
POST /api/v1/webhooks/github
```

Required headers:
- `X-GitHub-Event`
- `X-GitHub-Delivery`
- `X-Hub-Signature-256`
- `Content-Type`

### 11.5 Signature validation

- Capture the raw request body before JSON parsing changes it.
- Compute HMAC-SHA256 using the configured webhook secret.
- Compare using a constant-time comparison.
- Reject invalid/missing signatures.
- Do not log the secret or sensitive payload data.
- Validate event type and payload shape before processing.

### 11.6 Webhook subscriptions

| Event | Actions / handling |
|---|---|
| `push` | Record commits |
| `pull_request` | Opened, reopened, synchronize, closed |
| `pull_request_review` | Submitted |
| `release` | Published |
| `installation` | Created, deleted, suspend, unsuspend |
| `installation_repositories` | Added, removed |

Validate the exact event/action payloads against current GitHub documentation and test fixtures.

### 11.7 Webhook processing flow

1. Receive request.
2. Validate signature against raw body.
3. Read delivery ID and event type.
4. Deduplicate using unique `delivery_id`.
5. Persist delivery and payload/status.
6. Process event idempotently.
7. Update normalized GitHub records.
8. Create activity and outbox events in the same transaction where possible.
9. Mark delivery processed.
10. Return a successful response after durable acceptance/processing.

### 11.8 Reliability and recovery

GitHub can retry webhook deliveries. Repeated delivery must not duplicate commits, PRs, reviews, activity, or notifications.

Use:
- Unique delivery ID.
- Unique GitHub entity identifiers.
- Idempotent upserts.
- Explicit processing states (e.g. `RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`).
- Retry/recovery mechanism for failed deliveries.
- Bounded execution compatible with serverless limits.

Do not rely on a background worker living inside a serverless function after the HTTP response. Use a durable processing/recovery design compatible with the chosen deployment platform.

### 11.9 Event behavior

**Push**
- Confirm repository is connected to a project.
- Upsert commits using `(repository_id, sha)`.
- Record activity.
- Publish `github.commit.received`.

**Pull request**
- Upsert PR using stable GitHub PR ID and repository.
- Update state, branches, title, URL, author, draft and merge data.
- Optionally detect task references.
- Record activity.
- Publish `github.pull_request.updated`.

**Pull request review**
- Upsert review by GitHub review ID and PR.
- Record activity.
- Publish `github.review.submitted`.

**Release**
- Record release activity and relevant metadata.

**Installation/repository changes**
- Update installation state.
- Synchronize accessible repositories.
- Mark removed or inaccessible repositories disconnected.
- Stop accepting their events into active project views.
- Preserve historical data according to retention policy.

### 11.10 Task-to-PR linking

- A task may link to multiple PRs.
- A PR may be linked to multiple tasks only if this is deliberately supported by product rules.
- Manual linking is required.
- Branch/PR text task-key detection is optional convenience.
- Never automatically mark a task done merely because a PR is merged.

---

## 12. NestJS module boundaries

Use a modular monolith. Do not introduce microservices for the MVP.

Suggested backend layout:

```text
apps/api/src/
├── auth/
├── users/
├── workspaces/
├── invitations/
├── members/
├── projects/
├── tasks/
├── comments/
├── labels/
├── milestones/
├── github/
│   ├── installations/
│   ├── repositories/
│   ├── pull-requests/
│   ├── webhooks/
│   └── commits/
├── activity/
├── notifications/
├── realtime/
├── outbox/
├── database/
└── common/
    ├── guards/
    ├── decorators/
    ├── filters/
    ├── interceptors/
    ├── pipes/
    └── policies/
```

### Module rules

- Each module owns its business logic.
- Controllers handle transport concerns; services handle business rules.
- Database access uses Drizzle through a defined database module/repository boundary.
- Avoid circular module dependencies.
- Use explicit service contracts between modules.
- Shared packages contain reusable types, schemas, UI, and configuration—not hidden application business logic.
- Webhook controllers are isolated from normal user-authenticated controllers.
- Real-time publishing is an abstraction used after successful persistence.

---

## 13. Monorepo structure

```text
devtrack/
├── apps/
│   ├── website/
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       ├── features/
│   │       ├── hooks/
│   │       └── lib/
│   └── api/
│       └── src/
│           └── [NestJS modules]
├── packages/
│   ├── database/
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── index.ts
│   ├── ui/
│   ├── types/
│   ├── validators/
│   ├── config/
│   └── eslint-config/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Frontend feature organization

Suggested features:
- `auth`
- `workspaces`
- `projects`
- `tasks`
- `comments`
- `github`
- `activity`
- `notifications`
- `settings`

The frontend must use the API for business operations. It must not import server-side database modules.

---

## 14. Security requirements

Security is part of the MVP.

| Area | Requirement |
|---|---|
| Passwords | Argon2id |
| Sessions | Secure, HTTP-only cookies and revocation |
| OAuth | State validation and safe account linking |
| Authorization | Backend RBAC and project/workspace checks |
| Multi-tenancy | Workspace-scoped queries |
| GitHub credentials | Server-side encrypted storage |
| Webhooks | HMAC-SHA256 validation |
| Invitations | Random, hashed, expiring, single-use tokens |
| API | Rate limiting and validation |
| WebSockets | Authenticated connections and authorized room joins |
| Logging | Never log passwords, tokens, private keys, or secrets |
| Database | Foreign keys, constraints, transactions |

Additional:
- CSRF protection appropriate to cookie/session design.
- Strict CORS allowlist.
- Secure OAuth callback handling.
- Prevent cross-workspace IDOR.
- Do not expose GitHub App private keys or installation tokens to the browser.
- Revoke/rotate credentials when installations are removed or compromised.
- Validate and sanitize user-generated content appropriately.
- Restrict comment and invitation abuse through rate limits.

---

## 15. Non-functional requirements

Initial engineering targets (not contractual SLAs):

| Category | Target |
|---|---|
| Normal API reads | p95 under 500 ms under expected MVP load |
| Real-time updates | Normally delivered within 2 seconds |
| Reliability | Webhook processing idempotent and recoverable |
| Availability | Graceful handling of database/provider outages |
| Security | Every protected resource enforces authorization |
| Scalability | Stateless API functions and external coordination |
| Maintainability | Modular NestJS architecture |
| Observability | Structured logs and request correlation IDs |

### Observability

Include:
- Request IDs.
- Structured application logs.
- Error tracking.
- Webhook delivery/processing status.
- Outbox backlog and retry visibility.
- API latency/error metrics.
- Real-time connection/error metrics where supported.
- Database query/error monitoring.

---

## 16. Testing strategy

### Unit tests
- Authentication services.
- Workspace/project authorization.
- Task business rules and status transitions.
- Task number allocation.
- Comment and mention behavior.
- Notification creation.
- GitHub webhook handlers.
- Signature validation.
- Outbox publishing logic.

### Integration tests
- Registration and login.
- GitHub OAuth callback.
- Workspace membership and invitations.
- Project and task CRUD.
- Cross-workspace access rejection.
- Comment creation and mentions.
- GitHub App installation synchronization.
- Repository selection.
- Webhook signature verification.
- Duplicate webhook delivery.
- Transactional persistence of business data and outbox event.

### End-to-end tests
1. Register and verify a user.
2. Create workspace.
3. Invite another user.
4. Accept invitation.
5. Create project.
6. Create and assign task.
7. Install GitHub App.
8. Select and connect repository.
9. Receive push webhook.
10. Receive pull request webhook.
11. Link PR to task.
12. Post comment and mention teammate.
13. Verify activity and notification updates.
14. Verify real-time updates for authorized connected users.

### Security tests
- Access another workspace's project by guessed ID.
- Modify another user's task without permission.
- Join unauthorized WebSocket room.
- Replay invitation token.
- Submit invalid webhook signature.
- Replay duplicate webhook delivery.
- Attempt OAuth state mismatch.
- Attempt to access an unselected repository's project activity.

---

## 17. MVP acceptance criteria

The MVP is ready for release only when all are verified:

1. Users can register, verify email, log in using email/password or GitHub, and log out.
2. Users can create and access workspaces they belong to.
3. Administrators can invite members and recipients can accept invitations securely.
4. Owner/Admin/Member permissions are enforced by the backend.
5. Users can create, update, archive, and access authorized projects.
6. Users can create, assign, update, and manage tasks in Kanban and List views.
7. Task identifiers are unique and safely allocated under concurrent creation.
8. Users can comment, edit/delete their own comments, and mention members.
9. GitHub App can be installed by an authorized workspace administrator.
10. Administrators can select repositories and connect them to projects.
11. Push, PR, review, release, and installation/repository events are synchronized.
12. Users can link PRs to tasks.
13. Project activity displays relevant user and GitHub events.
14. Users can receive and manage notifications.
15. Authorized connected users receive relevant updates without refreshing.
16. Reconnection restores subscriptions and reconciles current state.
17. Duplicate webhooks do not create duplicate records/activity.
18. Failed webhook processing can be recovered.
19. Cross-workspace and unauthorized operations are rejected.
20. Production frontend, API, database, GitHub integration, email, and real-time delivery work together.

---

## 18. Explicitly excluded from MVP

Do not implement these unless scope is deliberately changed:

- Full chat/messaging system.
- Calendar view.
- Gantt charts.
- Time tracking and timesheets.
- File attachments and file management.
- Advanced automation rules.
- AI project assistant.
- Client-facing external portal.
- GitHub write operations, code changes, or automatic PR merging.
- Microservices.
- Complex custom workflow builder.
- Advanced reporting/analytics.

Keep the MVP focused on the core engineering workflow.

---

## 19. Implementation milestones

| Milestone | Deliverables |
|---|---|
| M1 — Foundation | Monorepo, database, migrations, authentication |
| M2 — Workspace | Workspace, membership, RBAC, invitations |
| M3 — Project/task | Projects, project membership, tasks, Kanban, List |
| M4 — Collaboration | Comments, mentions, activity, notifications |
| M5 — GitHub setup | GitHub App installation, repository selection |
| M6 — GitHub events | Webhooks, commits, PRs, reviews, task linking |
| M7 — Real-time | Socket.IO/real-time adapter, Redis coordination, reconnect/reconcile |
| M8 — Release readiness | Security, tests, monitoring, deployment |

### Definition of done for each milestone

- Implementation complete.
- Database migrations included where needed.
- Unit/integration tests included.
- API contracts documented.
- Authorization tested.
- Changes reviewed through GitHub pull requests.
- No untracked architectural decisions hidden in implementation.

---

## 20. Open implementation decisions

These are intentionally not hard-coded into the architecture yet.

1. **Email provider:** Choose a transactional email service for verification, invitations, and password resets.
2. **Redis provider:** Choose a managed Redis provider compatible with the selected Socket.IO adapter and deployment.
3. **Real-time hosting validation:** Verify current Vercel WebSocket/runtime behavior and choose direct Socket.IO hosting or managed real-time delivery accordingly.
4. ~~**Session implementation:**~~ **Resolved in M1.** Opaque, database-backed sessions, with no session library. See `Docs/decisions/0001-authentication-and-sessions.md`. The Vercel proxy and client-IP behaviour still need checking in M8.
5. **GitHub App details:** Register the app, validate exact permissions, webhook subscriptions, callback URLs, and installation lifecycle. *M5: installation is verified with user authorization during installation; installation tokens are minted on demand and never stored; repositories may be shared by projects of one workspace; registration settings and permissions are listed. The live install flow was confirmed on 2026-11-06. M6: webhook subscriptions (push, pull request, pull request review, release, plus installation lifecycle), signature checking, and inline processing with a cron-driven retry. See `Docs/decisions/0005-github-app-setup.md` and `0006-github-events.md`.*
6. ~~**Task deletion policy:**~~ **Resolved in M3.** Soft deletion (`tasks.deleted_at`), by the reporter or a workspace Admin/Owner. See `Docs/decisions/0003-projects-and-tasks.md`.
7. **Activity retention:** Define retention and payload minimization for raw webhook deliveries and activity records. *M4: payloads are minimized (no comment or description text); everything is kept for the MVP and pruning is decided in M8. M6: raw webhook payloads are cleared once a delivery is processed or ignored (kept only on failures, for retry). See `Docs/decisions/0004-collaboration.md` and `0006-github-events.md`.*

Do not guess these details. Validate them during the relevant implementation milestone and document the final decision.

---

## 21. Engineering-agent instructions

When Claude or another coding agent uses this document:

1. Treat the confirmed decisions in Section 2 as the current product baseline.
2. Do not silently expand MVP scope.
3. Do not introduce microservices.
4. Do not let the frontend access PostgreSQL directly.
5. Do not treat GitHub OAuth as GitHub App installation.
6. Do not treat Redis or WebSocket events as durable application state.
7. Persist business changes and outbox events transactionally.
8. Enforce workspace/project authorization in the backend.
9. Validate Vercel's current WebSocket/runtime constraints instead of assuming a persistent server.
10. Use Drizzle migrations and keep schema changes version-controlled.
11. Implement and test one milestone at a time.
12. Before changing an architectural decision, explain the trade-off and request approval.
13. Prefer the simplest design that satisfies the documented requirements.
14. Keep API contracts, database schema, and shared types consistent.
15. Do not mark a milestone complete without tests and acceptance evidence.

### Recommended first engineering task

Start with **M1 — Foundation**:

- Inspect the existing repository, if one exists.
- Confirm the current pnpm/Turborepo conventions.
- Establish or verify `apps/website`, `apps/api`, and `packages/database`.
- Configure Drizzle and Neon.
- Define the initial identity schema (`users`, `accounts`, `sessions`).
- Implement registration, email verification, login, logout, and GitHub OAuth.
- Add tests and document the authentication/session decisions.

Do not implement all modules at once. Build the foundation, validate it, and then proceed milestone by milestone.

---

## 22. Source-of-truth hierarchy

When project materials conflict, use this order:

1. Explicitly approved decisions in the current project conversation.
2. This architecture document, after it has been updated to reflect approved decisions.
3. Current implementation and tests, where they reveal existing constraints that need review.
4. External vendor documentation for current platform behavior.
5. Agent assumptions — these are never authoritative.

Record approved architecture changes in this document so future sessions and agents share the same context.
