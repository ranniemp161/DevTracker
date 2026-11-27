# 0026 — Linking GitHub releases to milestones

- **Status:** Accepted (user answers, 2026-11-28)
- **Date:** 2026-11-28
- **Scope:** Store GitHub releases from connected repositories and allow linking multiple releases to a milestone (manually or automatically on publish)
- **Builds on:** [0006](0006-github-events.md) (`release.published` webhook, repository scoping), [0025](0025-milestone-stages-and-scope.md) (milestone delivery stages)

## 1. Outcome

Teams delivering across one or more repositories can see which GitHub releases belong to a milestone—without leaving DevTracker or changing how stages work.

- A milestone can have **multiple** linked releases (supporting multi-repo projects and hotfix releases).
- Releases are stored when `release.published` webhooks arrive for connected repositories.
- Leads and workspace Owners/Admins can **manually** link or unlink releases on the Milestones page, and DevTracker **automatically** links a newly published release when its tag or name matches an undelivered milestone's name.
- Linked releases are **display-only** (tag, repository, external link, published date) plus an activity entry; linking or publishing never changes a milestone's stage.

## 2. Data model

- `github_releases`: `id`, `repository_id` (FK `github_repositories.id`, cascade), `tag_name`, `name` (nullable), `url`, `prerelease` (boolean, default `false`), `published_at` (timestamptz, default now), `created_at`, `updated_at`. Unique on `(repository_id, tag_name)`.
- `milestone_github_releases`: `milestone_id` (FK `milestones.id`, cascade), `release_id` (FK `github_releases.id`, cascade), `source` (`task_link_source`: `MANUAL | AUTO`), `linked_by` (nullable FK `users.id`, set null), `created_at`. Primary key `(milestone_id, release_id)`.

## 3. Webhook & auto-linking

On `release` (`action: 'published'`) for a connected repository:

1. Upsert `github_releases` by `(repository_id, tag_name)` updating `name`, `url`, `prerelease`, and `published_at`.
2. For each connected non-archived project, find undelivered milestones (`status <> 'DELIVERED'`) whose normalized name matches the normalized `tag_name` or `release.name` (trimmed, case-insensitive, ignoring a leading `v` before a digit, e.g. `v1.2` matches `1.2` and `v1.2`).
3. Insert matching links with `source: 'AUTO'`, `linked_by: null` (`onConflictDoNothing`), and record `milestone.release_linked` activity for newly created links.

## 4. API

- `GET /projects/:id/releases`: project access; lists releases from repositories currently connected to the project, newest `published_at` first.
- `Milestone.releases`: hydrated on `GET /projects/:id/milestones` and milestone mutations (`LinkedMilestoneRelease[]`, newest `published_at` first).
- `POST /milestones/:id/releases` (`{ releaseId }`): requires milestone management access (`manage: true`); verifies the release belongs to a repository connected to the milestone's project; links with `source: 'MANUAL'`, records `milestone.release_linked`, and returns `{ milestone }`.
- `DELETE /milestones/:id/releases/:releaseId`: requires milestone management access (`manage: true`); removes the link, records `milestone.release_unlinked`, and returns `{ milestone }`.

## 5. Decisions (user answers, 2026-11-28)

1. **Cardinality:** Multiple releases per milestone.
2. **Linking:** Manual link from connected repos' releases, plus auto-link when a published release's tag or name matches an undelivered milestone.
3. **Stage behavior:** Display-only + activity entry; never auto-moves or prompts stage changes.

## 6. Website

- **Milestones page:** each milestone lists its releases as `tag · repository` links to GitHub, newest first, with the publish date and an "auto" hint for automatic links.
- **Leads and admins** get **Link release** (a picker of the project's releases not yet linked to that milestone) and a remove button on each release.
- Tokens only, per SPEC. Nothing about a release changes the stage menu or the "Move to client review?" banner (0025 §4).

## 7. Notes

- **Releases are stored from this change on.** Earlier releases aren't backfilled from GitHub; the activity feed already has them.
- **Prereleases** are stored and can be linked, and are marked "pre-release".
- **The payload's `published_at`** is used when GitHub sends it; otherwise the time the delivery is processed.
- **A repository disconnected from the project** keeps its links (history), but its releases leave the project's picker.
- **Archived projects** are read-only: linking and unlinking return `409 PROJECT_ARCHIVED`.

## 8. Migration (additive)

`0031_github_releases`: the two tables in §2. It runs against the shared database only after the user approves the SQL.

## 9. Tests

End-to-end on PGlite:

- a published release is stored once per tag (a re-publish updates it) and auto-links to an undelivered milestone whose name matches its tag or name (`v1.2` ↔ `1.2`), never to a delivered one or another project's;
- manual link and unlink: leads and admins only, releases from unconnected repositories refused, activity recorded;
- `GET /projects/:id/releases` lists only connected repositories' releases;
- linking never changes the milestone's stage.
