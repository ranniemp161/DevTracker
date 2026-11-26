# 0022 — Attachments on the public request form

- **Status:** Accepted (user answers, 2026-11-26)
- **Date:** 2026-11-26
- **Scope:** Let people sending a bug or request through the public form attach screenshots and Markdown files, and show those files to the team in Triage and on the task
- **Builds on:** [0016](0016-request-form-and-triage.md) (request form and Triage), [0019](0019-markdown.md) (Markdown), `Docs/task-media-storage.md` (private R2 task media)

## 1. Outcome

A client can add screenshots and Markdown files when they report a bug or ask for a change. The files become ordinary **task attachments** on the Backlog task the request creates, so the team sees them in Triage and on the task page. A Markdown attachment shows as a **rendered preview** wherever task attachments are shown, not only as a raw file.

## 2. What can be attached (user answers)

- **Types:** PNG, JPEG, GIF and WebP images, plus Markdown (`.md`, `.markdown`, stored as `text/markdown`). No video, no SVG.
- **Limits:**
  - at most **5 files** per request;
  - **10 MB** per image;
  - **256 KB** per Markdown file.
- **Markdown handling:** each file stays a file, and the team sees it rendered. It is never merged into the description, which is capped at 5,000 characters.

## 3. Upload flow

Uploads use the same private R2 bucket and two-step flow as task attachments: a pending object first, which is verified and then copied to its final key.

1. **The submission declares its files.** `POST /public/requests/:token` accepts an optional `attachments: [{ name, contentType, size }]` (up to 5).
   - Turnstile, the honeypot and the rate limits run first, exactly as in 0016.
   - In the same transaction that creates the task, the API inserts one `task_attachments` row per file with `uploader_id = NULL` (a person outside the team) and no `completed_at`.
2. **The response stays `202`.** It still never reveals the task key or any project data.
   - The body is `{ received: true, uploads: [{ id, url, headers }] }`, one presigned R2 `PUT` per file, valid for 5 minutes.
   - When nothing was declared, or the honeypot was filled in, `uploads` is `[]`.
3. **The browser uploads each file to R2,** then confirms it with `POST /public/requests/:token/attachments/:id/complete`.
   - The API checks that the attachment belongs to a task created by a request through **this** form, that it has no uploader, and that it was declared within the last **15 minutes**.
   - It then runs the same check as task attachments: the stored object's size and type must match the declared ones. If they match, it copies the object to `task-media/<id>` and sets `completed_at`.
   - Completing twice is harmless.
   - The attachment id is a random UUID that only the sender ever sees, so it serves as the upload capability. No extra token or secret is needed.
4. **A failed upload doesn't lose the request.** The task already exists without that file. The form says which file failed and lets the sender retry it within the 15-minute window.
5. **Unconfirmed uploads** never appear anywhere, because lists show only completed attachments. Their pending objects expire through the existing one-day R2 lifecycle rule on `pending-task-media/`.

## 4. Abuse limits

- Turnstile must pass before any upload link is issued, and the existing submission limits still apply (5 per IP per hour, 100 per form per day).
- A new rate limit: **20 declared files per IP per hour** (`request-media:ip`).
- When uploads aren't configured (no R2), the API answers as before, ignores declared files and returns `uploads: []`. The form hides its attachments area when `GET /public/requests/:token` reports `uploadsEnabled: false`.

## 5. Showing Markdown

- `GET /tasks/:id/attachments/:attachmentId/content` returns the text of a completed Markdown attachment, at most 256 KB, after the normal task read-access check. Any other type answers 400.
- The website renders that text with the existing Markdown renderer (0019), which escapes raw HTML. Images inside the Markdown are not loaded from other sites.
- **Triage:** each request in the list carries its completed attachments (id, name, type, size, signed URL), so Triage shows image thumbnails and Markdown previews without an extra request per row.

## 6. Data and migration

There is no migration. `task_attachments` already allows a NULL `uploader_id` and any content type. `text/markdown` is already an allowed task media type. Declined requests soft-delete their task (0016), and the attachments stay with it, like any other task's.

## 7. Tests

The end-to-end tests run on PGlite with the S3 client stubbed, and cover:

- a submission with declared files returning one upload per file, and the limits on count, types and sizes;
- completing: a match, a mismatch, a file from another form, a file uploaded by a member, an expired window, and completing twice;
- the honeypot and disabled uploads returning `uploads: []`;
- the per-IP file limit;
- the Markdown content endpoint: access, type and size;
- Triage including completed attachments only.
