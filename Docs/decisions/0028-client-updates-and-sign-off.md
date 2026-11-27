# 0028 — Client updates by email and milestone sign-off by link

- **Status:** Accepted (user answers, 2026-11-28)
- **Date:** 2026-11-28
- **Scope:** Tell clients what happened to the requests they sent, and let them approve a delivery or ask for changes, all without an account
- **Builds on:** [0016](0016-request-form-and-triage.md) (public form, contact details and their deletion), [0022](0022-request-attachments.md), [0023](0023-project-leads-and-internal-triage.md) (decline reasons, `responsible()`), [0024](0024-triage-gate-and-milestone-scheduling.md) (accepting into a milestone), [0025](0025-milestone-stages-and-scope.md) (stages), [0026](0026-milestone-github-releases.md) (releases), [0008](0008-release-readiness.md) (Resend)
- **Changes:** architecture §1 "Clients never log in and see nothing after submitting". Clients still never log in; they now hear back, and can sign off.

## 1. Outcome

The client's story gets an ending:

1. They send a bug or request through the public form, as today.
2. They get an email when it's **accepted** (with the milestone, if scheduled) or **declined** (with the reason), when its task is **done**, and when its milestone is **delivered**.
3. When a milestone reaches **Client review**, the lead sends them a private **sign-off link**. They read what was promised and press **Approve** or **Request changes**.
4. Approving tells the lead, who marks it Delivered. Asking for changes puts their note in Triage.

No accounts, no client portal: each link shows one thing.

## 2. Status emails (user answer: all four)

- **Who gets them:** the form reporter, only if they left an email address and haven't stopped them (§2.3). Team proposals never email (the member already gets `REQUEST_TRIAGED`).
- **When:**
  | Email     | Sent when                                                       | Says                                                                 |
  | --------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
  | Accepted  | the request is accepted (0024 §3)                               | "We're working on it", plus "planned for <milestone>" when scheduled |
  | Declined  | the request is declined                                         | "We won't be doing this", plus the reason if the triager gave one    |
  | Done      | the request's task first moves to Done                          | "It's done"                                                          |
  | Delivered | the task's milestone moves to Delivered while the task is in it | "It has been delivered", plus linked release tags                    |
- Each is sent **at most once** per request (`task_requests.*_emailed_at`). Done and Delivered aren't sent for declined requests.
- **What an email may contain:** the project name, the request's title, the milestone name, the decline reason, release tags. Never task keys, comments, assignees, other tasks or internal notes.
- **Stopping them:** every email ends with **Stop emails about this request**, a link to `/u#token=<token>` (64 random hex characters, in the fragment so it never reaches server logs). The page asks once and then sets `emails_stopped_at`; opening the link alone changes nothing, so mail scanners can't unsubscribe anyone. The form says under the email field: "We'll email you when this request is accepted, done or delivered."
- **Declining a form request:** the decline dialog now shows the reason box for form requests too, with "The client will see this reason" when they get emails.
- **Sending:** after the change commits, through the existing mailer (Resend). Each email is claimed (its `*_emailed_at` set) before it's sent, so it goes out at most once. A failed send is logged and not retried; the change itself never fails because of email.
- **Contact deletion (0016 §5) still applies:** once contact details are deleted, nothing more is sent.

## 3. Sign-off link (user answer: the lead copies and sends it)

- **Getting it:** on a milestone in **Client review**, leads and admins see **Get sign-off link**. It creates `milestones.signoff_token` (32 random bytes) and shows `/s/<token>` with a copy button. **Replace link** makes a new token; the old link stops working.
- **When it works:** only while the milestone is in Client review. In any other stage the page says "This review link is no longer active." The token is kept, so moving back to Client review reopens the same link.
- **The page shows:** the project name, the milestone name and description, its due date, its acceptance criteria (text and whether each is met), and its linked release tags with their GitHub links. Nothing else: no tasks, people, comments or counts.
- **Spam protection:** the same as the request form (0016 §2): Cloudflare Turnstile, a honeypot, and rate limits (5 per IP per hour, 20 per link per day).

## 4. Approve and Request changes (user answers)

- **Approve:** an optional name and note (500 characters). DevTrack records `client_approved_at`, the name and the note on the milestone, writes `milestone.client_approved` to activity, and sends `MILESTONE_CLIENT_APPROVED` to the project's leads (or admins, `responsible()`). It **never moves the stage**: the lead marks it Delivered. The Milestones page shows "Approved by <name> on <date>" on the milestone. A second approval updates the record; the notification is sent again.
- **Request changes:** a required note (5,000 characters), optional name and email. It becomes a **request in Triage** like a form submission (a Backlog task with the "Request" label, 0016 §3), with `source = 'signoff'` and the milestone it came from. The Triage row says "Changes requested on <milestone>", and the Accept dialog preselects that milestone. If the client left an email, they get the §2 emails for it.
- Moving the milestone out of Client review closes the page for both actions.

## 5. Data (additive, one migration per build step)

- **Step 1 (`0032_client_status_emails`):** `task_requests` gains `email_token text UNIQUE`, `emails_stopped_at`, `accepted_emailed_at`, `declined_emailed_at`, `done_emailed_at`, `delivered_emailed_at`.
- **Step 2:** `milestones` gains `signoff_token text UNIQUE`, `client_approved_at`, `client_approved_name`, `client_approved_note`; `notification_type` gains `MILESTONE_CLIENT_APPROVED`.
- **Step 3:** `task_requests` gains `signoff_milestone_id uuid` (FK `milestones`, set null), and the `source` check gains `'signoff'`.

Each runs against the shared database only after the user approves the SQL.

## 6. API

- `GET /public/signoff/:token` → `{ project, milestone }` as in §3 (404 when unknown or not in Client review).
- `POST /public/signoff/:token/approve` `{ name?, note?, turnstileToken }` → 202.
- `POST /public/signoff/:token/changes` `{ note, name?, email?, turnstileToken }` → 202.
- `POST /milestones/:id/signoff-link` → `{ url }` (create or replace; leads and admins; Client review only).
- `POST /public/client-emails/stop` `{ token }` → 204 whether or not the token exists, so tokens can't be probed.

## 7. Out of scope

- Client accounts, a list of all their requests, or a client portal.
- Emails for any other change (priority, assignees, comments).
- Emailing the sign-off link from DevTrack (user answer: the lead sends it).

## 8. Decisions (user answers, 2026-11-28)

1. **Emails:** all four (accepted, declined, done, delivered).
2. **Sign-off link:** the lead copies it and sends it; DevTrack doesn't email it.
3. **Approve:** tells the lead, who decides; it never moves the stage.
4. **Request changes:** becomes a new request in Triage, linked to the milestone.
5. **Consent:** emails are on whenever the client leaves an address, with a note under the field and a stop link in every email.
6. **Approving twice:** updates the approval and notifies again.

## 9. Build order (one PR each)

1. **Status emails:** the four emails, the stop link, the decline-reason box for form requests.
2. **Sign-off link and page:** the token, the public page, Approve.
3. **Request changes:** the Triage request from the sign-off page.

## 10. Tests

- each email sent once, to the right address, only with an address and not stopped; contents never include task keys or comments; a mail failure doesn't fail the change;
- the sign-off page only in Client review, the replaced link stops working, Turnstile and rate limits apply;
- Approve records and notifies without moving the stage; Request changes lands in Triage linked to the milestone.
