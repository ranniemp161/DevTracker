# 0006 — GitHub webhooks, pull requests, commits, reviews and task links

- **Status:** Accepted (M6)
- **Date:** 2026-11-06
- **Scope:** Milestone M6 — architecture §7.5–§7.7, §8.2, §9 "GitHub", §10, §11.4–§11.10
- **Records:** Open decision #5 (webhook subscriptions and lifecycle) and #7 (payload retention)

Rules 1–3 were approved before implementation (§21 rule 12).

## 1. Processing and recovery (approved)

GitHub does **not** retry a failed delivery on its own, and a serverless function can't keep working after it responds (§11.8). So:

1. `POST /api/v1/webhooks/github` checks the HMAC signature against the **raw** request body (rule 4).
2. It stores the delivery once, keyed by GitHub's unique `X-GitHub-Delivery` ID. A duplicate returns 202 with `duplicate: true` and isn't applied again.
3. It **processes the delivery in the same request**. The event's changes (entities, activity, links, notifications and outbox rows) and the delivery's `PROCESSED` status commit in **one transaction**, so each delivery is applied exactly once.
4. If processing throws, the transaction rolls back. The delivery is marked `FAILED` with a short, payload-free error, and the response is still **202**: the delivery is stored, and DevTrack retries it itself.
5. A scheduled job calls `GET /api/v1/internal/github/deliveries/retry` with `Authorization: Bearer $CRON_SECRET`. It reprocesses:
   - `FAILED` deliveries, up to 5 attempts in total;
   - `RECEIVED` deliveries older than 2 minutes (stored, but never processed);
   - `PROCESSING` deliveries older than 10 minutes (interrupted).

   Each run handles at most 20 deliveries or 20 seconds. Without `CRON_SECRET`, the route answers 404.

6. Clicking **Redeliver** in GitHub on a `FAILED` delivery also reprocesses it.

A delivery is claimed with one conditional `UPDATE`, so the live request and the retry job never process it at the same time.

Delivery statuses are `RECEIVED`, `PROCESSING`, `PROCESSED`, `IGNORED` and `FAILED`. `IGNORED` covers valid deliveries DevTrack has nothing to do with: an unhandled event or action, a repository that isn't connected, or a payload of an unexpected shape. These are recorded with a reason and never retried.

The Vercel Cron schedule (every 5 minutes) is added with the deployment configuration in M8.

## 2. Linking pull requests to tasks (approved)

- **Manual:**
  - Anyone who can edit the task can link or unlink a PR: `POST /tasks/:id/pull-requests`, `DELETE /tasks/:id/pull-requests/:prId`.
  - The PR's repository must be connected to the **task's project**; otherwise the request returns 404.
  - Linking the same PR twice returns `409 PULL_REQUEST_ALREADY_LINKED`.
- **Automatic:**
  - When a PR is `opened`, `reopened` or `edited`, task keys in its **branch name or title** are matched case-insensitively, so `feature/dev-104-login` and `Fix DEV-104` both match. The body is ignored. At most 10 keys are read.
  - A key links only to a live task in a non-archived project the repository is connected to.
  - Automatic links have `source = AUTO` and no `linked_by`.
  - Automatic links are never removed when the key disappears.
- A task can link several PRs, and a PR can link several tasks (§11.10). Both are deliberately supported.
- **Task status is never changed by GitHub events or links** (§7.5). A merged PR doesn't move the task to Done.

## 3. Payload retention (approved; open decision #7)

- `github_webhook_deliveries.payload` is kept only until the delivery is `PROCESSED` or `IGNORED`, then set to `NULL`. `FAILED` deliveries keep it so they can be retried.
- Delivery ID, event, action, GitHub installation and repository IDs, status, attempts and timestamps are kept for auditing and dedupe.
- **Commit messages** are stored in `github_commits.message`, truncated to 2,000 characters.
- **Activity metadata** holds only display details:
  - the repository name;
  - a PR's number, title and URL;
  - for a push: the branch, the commit count, and up to 5 commits (short SHA, first line of the message, URL);
  - review state, release tag, name and URL;
  - the sender's GitHub login.
- Pruning old deliveries and activity is still decided in M8.

## 4. Webhook security

- The signature is HMAC-SHA256 with `GITHUB_APP_WEBHOOK_SECRET`, compared in constant time. Missing or invalid signatures get 401. The implementation is checked against GitHub's published test vector.
- The raw body is captured by a route-specific parser (`express.raw`, up to 25 MB, GitHub's limit) registered before Nest's JSON parser, so other routes keep the 100 KB JSON limit.
- If the secret isn't configured, the endpoint answers 503. In production it is required whenever the GitHub App is configured.
- URLs from payloads (`html_url`) must be `https://`. Otherwise the payload is ignored, because they are rendered as links.
- An installation is only ever bound to a workspace by the verified install flow (0005). Events for unknown installations are ignored. Repository events go only to non-archived projects of the installation's own workspace.
- Neither payloads nor SQL parameters are logged. Errors are logged through `describeError`, which redacts parameters.

## 5. Events handled (§11.6)

| Event                       | Actions                                                           | Effect                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `push`                      | branch pushes (tags and deletions ignored)                        | Upserts commits by `(repository, sha)`. One `repository.pushed` activity per push (new commits only), plus `github.commit.received`                                                    |
| `pull_request`              | `opened`, `reopened`, `closed`                                    | Upserts the PR. Activity `pull_request.opened`, `reopened`, `merged` or `closed`, plus `github.pull_request.updated`                                                                   |
|                             | `synchronize`, `edited`, `ready_for_review`, `converted_to_draft` | Updates the PR and emits `github.pull_request.updated`, with no feed entry. `edited` may auto-link                                                                                     |
| `pull_request_review`       | `submitted` (`approved`, `changes_requested`, `commented`)        | Upserts the review by `(PR, review ID)`. Activity `pull_request.reviewed`, plus `github.review.submitted`                                                                              |
| `release`                   | `published`                                                       | Activity `repository.release_published`. No table: §8.2 has none                                                                                                                       |
| `installation`              | `deleted`, `suspend`, `unsuspend`                                 | Sets status `REMOVED`, `SUSPENDED` or `ACTIVE`. `deleted` also disconnects every repository                                                                                            |
| `installation_repositories` | `removed`                                                         | Disconnects those repositories from every project. Activity `project.repository_disconnected` with `reason: access_removed`. Their later events are ignored, and their history is kept |
| `ping`                      | —                                                                 | 202 `PONG`, nothing stored                                                                                                                                                             |

**Out-of-order deliveries:** a PR row is only overwritten by data whose GitHub `updated_at` is at least as recent as the stored one. The review event's embedded PR follows the same rule.

## 6. Notifications (§7.7)

These go to the **reporter and assignees of every task linked to the PR**, if they can still access the project:

| Type                    | When                                                   |
| ----------------------- | ------------------------------------------------------ |
| `PULL_REQUEST_OPENED`   | PR opened (including tasks it was just auto-linked to) |
| `PULL_REQUEST_MERGED`   | PR closed with a merge                                 |
| `PULL_REQUEST_REVIEWED` | Review submitted                                       |

Notifications link to the task. Manual linking notifies nobody.

## 7. Who did it

The GitHub sender is shown as a DevTrack user only if that user signed in with GitHub (linked by **numeric** GitHub ID, never by login) **and** belongs to the workspace. Otherwise the actor is null, and the feed shows `<login> (GitHub)` from `metadata.github.login`. Bots are never mapped. A mapped sender isn't notified about their own action.

## 8. API

| Method | Endpoint                            | Who                                                                                                                     |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST   | `/webhooks/github`                  | GitHub (HMAC)                                                                                                           |
| GET    | `/internal/github/deliveries/retry` | Scheduler (`Bearer CRON_SECRET`)                                                                                        |
| GET    | `/repositories/:id/pull-requests`   | Access to a project the repository is connected to. `?state=open\|closed\|merged\|all`, cursor pagination, newest first |
| GET    | `/tasks/:id/pull-requests`          | Task access (M6 addition)                                                                                               |
| POST   | `/tasks/:id/pull-requests`          | Task edit access. `{ pullRequestId }`                                                                                   |
| DELETE | `/tasks/:id/pull-requests/:prId`    | Task edit access                                                                                                        |
| GET    | `/projects/:id/github/activity`     | Project access. The activity feed filtered to GitHub entries                                                            |

## 9. GitHub App settings for M6

These are in addition to 0005 §8:

- **Webhook:**
  - Active, URL `<API origin>/api/v1/webhooks/github`.
  - Content type `application/json`. Any type works, because the body is signed raw, but the payload must be JSON.
  - Secret = `GITHUB_APP_WEBHOOK_SECRET`.
- **Subscribe to events:** Push, Pull request, Pull request review, Release. `installation` and `installation_repositories` are delivered to every GitHub App automatically.
- **Permissions:** Metadata, Contents and Pull requests, all read-only. These are what the subscribed events require. Contents also covers `push` and `release`.
- **Local development:** GitHub can't reach `localhost`. Use a forwarding channel, for example `npx smee-client --url https://smee.io/<channel> --target http://localhost:4000/api/v1/webhooks/github`, and set the channel URL as the webhook URL.

## Implementation notes

- **Code layout** under `apps/api/src/github/`:
  - `webhooks/`: intake, retry and the event processor;
  - `pull-requests/`: listing and task links.
- The processor runs inside the delivery's transaction. It writes through `EventRecorder`, so activity, notifications and outbox rows commit with the change (§10).
- **Schema** (`0006_github_events`):
  - adds `github_webhook_deliveries`, `github_pull_requests`, `github_commits`, `github_reviews` and `task_github_links`;
  - adds the enums `webhook_delivery_status` and `task_link_source`.
- **Additions to §8.2:**
  - deliveries: `action`, `attempts`, `last_attempt_at`, with installation and repository stored as GitHub IDs;
  - PRs: `closed_at`, `opened_at`, `github_updated_at`;
  - commits: `branch`, `url`, `author_name`;
  - reviews: `url`;
  - links: `source`.

## Addendum (M7): importing existing pull requests

Webhooks only report what happens **after** a repository is connected, so pull requests opened or merged earlier never appeared in DevTrack (found while testing M7 against a real repository).

- **On connect,** DevTrack fetches the repository's **100 most recently updated** pull requests, in any state, through the installation (`GET /repositories/:id/pulls?state=all&sort=updated`).
  - They are stored with the same upsert and out-of-order guard as webhooks (rule 5).
  - Task keys in their branch names or titles are auto-linked (rule 2).
  - An import failure is logged and doesn't undo the connection.
- **`POST /projects/:id/repositories/:repoId/sync`** (workspace Admin/Owner, active installation) repeats the import on demand. The **Sync pull requests** button in Project Settings → Repositories calls it, and it is idempotent.
- **Imported history is quiet:** no activity entries, outbox events or notifications, including for the links it creates. Only live webhook events are news.
- Commits, reviews and releases aren't imported. Only pull requests are, because those are what tasks link to.
