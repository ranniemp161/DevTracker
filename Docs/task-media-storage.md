# Task media storage

Task attachments accept PNG, JPEG, GIF, WebP, MP4, WebM, and MOV up to 50 MiB. The API checks task access before issuing upload or read URLs. The browser uploads a single file directly to R2, and the API publishes its metadata only after checking the stored object and copying it to its final key.

## API and bucket setup

1. Create or select a private R2 bucket and issue an Object Read & Write API token scoped to that bucket.
2. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_TASK_MEDIA_BUCKET` on the API service. Keep the token out of website environment variables. Use a dedicated bucket for local or preview uploads.
3. Set the bucket CORS policy to allow `PUT` from the exact DevTracker website origins. Allow headers `Content-Type` and `If-None-Match`. Set a lifecycle rule that expires the `pending-task-media/` prefix after one day. Completed media uses the separate `task-media/` prefix.
4. Apply migration `0013_task_attachments.sql` using the normal DevTracker database migration workflow. Verify uploads in a test environment before enabling the API settings in production.

## Optional Cloudflare CDN delivery

R2 signed GET URLs work with the private bucket. To enable CDN delivery, deploy the Worker in [infra/task-media](../infra/task-media) to its `workers.dev` hostname. Set its `TASK_MEDIA` R2 binding to the same private bucket and provision `TASK_MEDIA_CDN_SECRET` as a Worker secret. Set the identical secret and the deployed Worker origin as `TASK_MEDIA_CDN_ORIGIN` on the API. Use a randomly generated secret with at least 32 bytes of entropy.

The public Worker entrypoint validates every media URL before calling its internal cached entrypoint. Full image responses can be cached at the edge, while video range reads stream from R2. Browser responses use `private, no-store`. Both delivery modes issue bearer URLs valid for up to 15 minutes. Users can refresh expired links from the task.

## Project chat Markdown files

Apply migration `0014_chat_markdown_attachments.sql` before rolling out the updated chat API. Chat supports one `.md` file of up to 32 KiB per message, with an optional caption. The API writes the file to the same private bucket under `chat-media/` and issues a 60-second R2 download URL after checking access to the live message. The chat upload goes through the API, so the existing browser upload CORS settings are sufficient. Deleting a message disables new download links for its file.

## Verification

Upload an image and a video from the website, reload the task, and check the preview and linked playback. Check that an unrelated project member cannot list, prepare, or complete uploads for the task. Also test an expired CDN URL after warming the cache, and verify the video responds to a byte range request.
