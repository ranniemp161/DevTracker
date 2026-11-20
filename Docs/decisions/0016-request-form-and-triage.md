# 0016 — Public request form and Triage

- **Status:** Accepted (user answers, 2026-11-20)
- **Date:** 2026-11-20
- **Scope:** Let people outside the team send bugs and requests to a project, and let the team triage them
- **Builds on:** [0003](0003-projects-and-tasks.md) (tasks), [0004](0004-collaboration.md) (notifications), [0008](0008-release-readiness.md) (retention, scheduled jobs)

## 1. Outcome

Tasks stay the only tracker: there is no separate ticket system. A project can turn on a **public request form**. Each submission becomes a Backlog task with a **Request** or **Bug** label. The team sees new submissions in a **Triage** tab and accepts or declines them.

## 2. The form (approved: public, user answer 3)

- **Link:** `/r/<token>`, where the token is 32 random bytes (base64url). Anyone with the link can submit without signing in. The page shows only the project name.
- **Turning it on and off:** project managers (`viewerCanManage`) do this in Project settings, and can **replace the link**. Replacing it gives the project a new token, and the old link stops working at once.
- **Fields:**
  - type: Bug or Request
  - title: 3–200 characters
  - description: up to 5,000 characters
  - name: optional, up to 80 characters
  - email: optional, a valid address
- **Spam protection:**
  - **Cloudflare Turnstile** is required when `TURNSTILE_SECRET_KEY` is configured, which production must do. The token is checked server-side with Cloudflare's siteverify endpoint, including the client IP.
  - A hidden honeypot field: if it's filled in, the request is accepted with 202 but nothing is stored.
  - Rate limits: 5 per IP per hour, and 100 per form per day.
- **Response:** `202 { received: true }`. The response never reveals the task key or any project data.

## 3. What a submission creates

- **The task:** a `BACKLOG` task in the project with the given title and description, no reporter, and no assignee.
- **The label:** a workspace label named "Request" or "Bug" is attached. If the label doesn't exist yet it is created, in amber for Request and red for Bug.
- **The request record:** a `task_requests` row with the task, the type, the reporter's name and email, and status `new`. Contact details live only here, never in the task, its activity or notifications.
- **Activity:** `task.created` with a null actor, and metadata `{ source: 'request_form' }`.
- **Notification:** `REQUEST_SUBMITTED` goes to the project's managers, meaning workspace Owners/Admins who are members of the project. It carries the title only, never contact details.

## 4. Triage (approved: task editors, user answer 2)

- **Who:** anyone who can edit tasks in the project triages.
- **The list:** `GET /projects/:id/requests?status=new|accepted|declined` returns each request with its task, type, the reporter's name and email (until they are deleted, §5), and when it arrived.
- **Accept:** `POST /requests/:id/accept` marks the request `accepted` and records who accepted it and when. The task stays as it is; people assign it and set its status through the usual task controls.
- **Decline:** `POST /requests/:id/decline` marks the request `declined` and soft-deletes the task, like deleting a task normally (0003). The request row stays, so the form's history still shows it.
- **Archived projects:** they are read-only, so the form returns 404 and triage is refused.
- **The Triage tab:** it appears in the project navigation for task editors, with a count of `new` requests.

## 5. Deleting contact details (approved: user answer 4)

- **What the job does:** the existing scheduled maintenance job sets `reporter_name` and `reporter_email` to NULL and records `contact_deleted_at`.
- **When:**
  - 90 days after the task is completed;
  - 90 days after the request is declined;
  - straight away if the task is hard-deleted (the row cascades).
- **Not covered:** requests still open or still being worked on keep contact details, so the team can reply.

## 6. Configuration

- **API:** `TURNSTILE_SECRET_KEY` is required in production when request forms are used. Without it, submissions skip the Turnstile check; that's only allowed outside production.
- **Website:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` loads the widget from `challenges.cloudflare.com`. For local development, use Cloudflare's always-pass test keys.

## 7. Migration (additive)

- `projects.intake_enabled boolean NOT NULL DEFAULT false` and `projects.intake_token text UNIQUE`, which is NULL until the form is first turned on.
- A `task_requests` table:
  - `id`
  - `task_id`: unique, cascades when the task is deleted
  - `project_id`: cascades
  - `kind`: `'bug'` or `'request'`
  - `status`: `'new'`, `'accepted'` or `'declined'`, default `'new'`
  - `reporter_name`, `reporter_email`, `contact_deleted_at`
  - `triaged_by`: set to NULL if the user is deleted
  - `triaged_at`, `created_at`
  - an index on `(project_id, status, created_at)`
- The `notification_type` enum gains `REQUEST_SUBMITTED`.

The migration runs against the shared database only after the user approves the SQL.

## 8. Tests

The end-to-end tests run on an in-memory database (PGlite) and cover:

- submitting, including the label being created and reused;
- the honeypot;
- a missing or invalid Turnstile token (using a stub verifier);
- both rate limits;
- a disabled form, a replaced link and an archived project;
- triage permissions, accept and decline;
- the notification going only to managers;
- contact details deleted after 90 days.
