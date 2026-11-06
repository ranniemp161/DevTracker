# 0005 — GitHub App installation and repository selection

- **Status:** Accepted (M5)
- **Date:** 2026-11-06
- **Scope:** Milestone M5 — architecture §7.5, §8.2, §9 "GitHub", §11.1–§11.3, §14
- **Records:** Open decision #5 (GitHub App details), partly. Webhooks are M6.

The first three rules were approved before implementation (§21 rule 12).

## 1. Proving who installed the app (approved)

GitHub's redirect after installation carries an `installation_id` that anyone can change. If DevTrack trusted it, an admin could attach another organization's installation, and with it that organization's repositories, to their own workspace.

To bind an installation to a workspace, DevTrack checks three things:

1. **Same browser.** `GET /github/install` stores a random state (hashed, 30-minute TTL, single use) with the user and workspace, and sets it in an HttpOnly, SameSite=Lax cookie. The callback must return the same state in the query and the cookie.
2. **Still an admin.** The user who started the flow must still be an Admin or Owner of the workspace when GitHub redirects back.
3. **Controls the installation on GitHub.** The GitHub App has **"Request user authorization (OAuth) during installation"** turned on, so the callback includes a `code`. DevTrack exchanges it for a user token, checks that `GET /user/installations` lists the `installation_id`, and then revokes the token. It is never stored.

If any check fails, the browser is sent back to workspace settings with `?githubError=CODE` and nothing is recorded. An installation started on GitHub (no DevTrack state) is not bound to any workspace.

When a GitHub organization member asks an organization owner to approve the app (`setup_action=request`), nothing is installed and settings shows `?github=requested`.

## 2. One installation, one workspace; repositories shared within it (approved)

- `github_installations.github_installation_id` is unique, so an installation can never serve two workspaces. A second workspace gets `409 GITHUB_INSTALLATION_IN_USE`. Running the flow again from the same workspace refreshes the account details.
- A repository can be connected to **several projects of the same workspace**, for example a monorepo. From M6, its activity appears in each of them. Connecting checks that the installation belongs to the project's workspace, so a repository never crosses workspaces.

## 3. No stored GitHub credentials (approved)

- The App's private key is loaded from the environment (`GITHUB_APP_PRIVATE_KEY`) and signs short-lived RS256 App JWTs using Node's `crypto`, with no extra dependency.
- Installation access tokens are minted when needed and cached **in process memory only**, refreshed 5 minutes before GitHub's one-hour expiry.
- No token, key or secret is written to the database, activity or outbox. This meets §14 "server-side encrypted storage" by not storing credentials at all, so there is no encryption key to manage or rotate.

## 4. Who can do what

| Action                                                                         | Who                                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Start an installation, list installations                                      | Workspace Admin/Owner                                                                                           |
| List an installation's repositories (`/github/installations/:id/repositories`) | Workspace Admin/Owner. This reveals repositories that aren't connected to any project, so Members can't use it. |
| Connect or disconnect a repository                                             | Workspace Admin/Owner. Archived projects are read-only (`409 PROJECT_ARCHIVED`).                                |
| List a project's connected repositories                                        | Anyone with project access                                                                                      |

As elsewhere, users outside the workspace get 404, and Members get 403 on admin actions.

## 5. Repository selection

- The list of available repositories is read **live from GitHub**, up to 1,000 per installation. Each entry includes `connectedProjectIds` for this workspace.
- A repository is identified by its **GitHub numeric ID** (§11.3). Before connecting, DevTrack asks GitHub for the repository through the installation. If the installation can't access it, the request fails with `422 GITHUB_REPOSITORY_NOT_ACCESSIBLE`.
- `github_repositories` rows are created on first connection. `connected_at` is the first connection, and `disconnected_at` is set when the last project disconnects and cleared on reconnection. Rows are **never deleted** by disconnection, so M6 history stays attached.
- Names, owner, default branch and visibility are refreshed whenever an admin lists the installation's repositories, and on every connection. Repositories can be renamed on GitHub.
- A duplicate connection returns `409 REPOSITORY_ALREADY_CONNECTED`.

## 6. Installation status

`ACTIVE`, `SUSPENDED` or `REMOVED`. Until M6 processes `installation` webhooks, DevTrack learns about status changes when it asks GitHub for a token:

- A 404 marks the installation `REMOVED`.
- A 403 "suspended" response marks it `SUSPENDED`.

After that, calls fail fast with `409 GITHUB_INSTALLATION_UNAVAILABLE`. Reinstalling on GitHub creates a new installation ID, which goes through the normal flow. Unsuspending is detected in M6 through webhooks, or by running the install flow again.

## 7. Activity and outbox

In the same transaction as the change (M4 rule 3):

| Action                            | Activity metadata                           | Outbox event                      |
| --------------------------------- | ------------------------------------------- | --------------------------------- |
| `github_installation.installed`   | `{ account }` (workspace-level, no project) | `activity.created`                |
| `project.repository_connected`    | `{ repository: { id, fullName } }`          | `project.repository_connected`    |
| `project.repository_disconnected` | `{ repository: { id, fullName } }`          | `project.repository_disconnected` |

## 8. Registering the GitHub App

Validated with a fake GitHub in tests, and with a real app on 2026-11-06 (a personal-account installation went through the full flow).

- **Permissions** (§11.1, read-only):
  - Repository **Metadata: Read** is the only one M5 uses.
  - Also grant **Contents: Read** and **Pull requests: Read** now, because M6 needs them. GitHub asks organization owners to re-approve any permission added later.
- **Callback URL:** `<WEB_ORIGIN>/api/v1/github/install/callback`.
- **Request user authorization (OAuth) during installation:** on (rule 1). GitHub then ignores the Setup URL.
- **Redirect on update:** off. Updates started on GitHub carry no DevTrack state.
- **Webhook:** may stay inactive until M6, which adds `POST /api/v1/webhooks/github` and its secret.
- **Where can this GitHub App be installed:** "Any account" if the teams that use DevTrack belong to more than one GitHub organization.

**Confirmed on live GitHub (2026-11-06):** with user authorization requested, GitHub passes `state` back on the installation redirect along with `code` and `installation_id`.

## Implementation notes

- **Code layout** (§12):
  - `apps/api/src/github/` holds `github-app.client.ts`, the only code that talks to GitHub, and which tests replace with `FakeGithubAppClient`.
  - `installations/` contains the flow, list and available repositories.
  - `repositories/` contains project connections.
- **Schema:**
  - `github_install_states` and `github_installations.installed_by` are M5 additions to §8.2.
  - GitHub IDs are `bigint` columns, read as JS numbers. GitHub's IDs are far below 2^53.
- **§9 shapes:**
  - `GET /github/installations` takes `?workspaceId=` and returns `{ appConfigured, installations }`, so the UI can explain a server without App credentials.
  - Malformed UUIDs in paths return 404, as in other modules.
