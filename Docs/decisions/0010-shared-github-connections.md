# 0010 - Shared GitHub installations with scoped workspace connections

- **Status:** Accepted
- **Date:** 2026-11-08
- **Supersedes:** The single-workspace installation restriction and unrestricted repository picker in 0005; single-workspace event routing in 0006.

## Purpose and scope

An agency can keep several clients' repositories in one GitHub organization while
tracking each client's project in its own DevTrack workspace. Installing the App
once must not prevent another independently authorized workspace from connecting.

DevTrack tracks project development and delivery progress. Payments happen outside
the application; payment gateways and payment processing are outside its scope.

## Data and authorization

- `github_installations` holds one canonical installation record per GitHub ID.
- `github_workspace_connections` connects an installation to a workspace, uniquely
  by `(workspace_id, installation_id)`. Its UUID is the `installationId` used by
  browser-facing API routes and project repository requests.
- `github_workspace_repositories` explicitly allows repository IDs for a connection.
  **New connections start with an empty allowlist.**
- Both new installations and existing-installation authorization verify browser
  state and the initiating user's current workspace Admin/Owner role.
- GitHub's `/user/installations` proves installation access. The user-scoped
  `/user/installations/:id/repositories` bounds the repositories the user can
  delegate. Installation-token access alone must never authorize delegation.
- The user token is revoked after verification and is never persisted. The
  connection retains verified repository IDs; reconnecting refreshes that list.
  Ungranted candidates are visible only to the most recent GitHub authorizer
  (`connected_by`), not to every workspace admin. Other admins see the allowlist
  and must complete their own GitHub authorization to discover or grant more.
  Existing explicit grants remain until removed, so reauthorization by an admin
  with narrower GitHub access does not silently revoke an earlier delegation.
- Admins may manage their workspace's allowlist; project members cannot. Existing
  grants and newly verified candidates are intersected with live App access for
  the access editor. Project pickers return only allowed repositories.
- Repository metadata and PR records may be shared internally for an explicitly
  shared repository. Project IDs, activity, task links, actors and notifications
  remain scoped to authorized projects/workspaces.

## Browser flow

1. **Install on GitHub** runs the existing installation flow. **Connect existing
   installation** uses the App's user authorization flow and registered callback.
2. For an existing installation, the callback prepares browser-bound choices in a
   hashed, single-use flow expiring after ten minutes. Choices are bound to the
   DevTrack user and target workspace; they are not a global installation catalog.
3. The admin selects a verified account/organization and connects it.
4. Under **Repository access**, the admin checks allowed repositories and explicitly
   saves. Unchecking a connected repository warns that its project connections in
   this workspace will be removed. Past activity and task/PR history remain.
5. Project settings offers the workspace's allowed repositories for connection.

The App's callback remains `<WEB_ORIGIN>/api/v1/github/install/callback`, with
**Request user authorization during installation** enabled. No new App permissions
or credentials are required. Reauthorize after gaining access to more repositories.

## Disconnection and events

**Disconnect workspace** removes only this workspace's connection, grants and
project repository links. It does not uninstall the App or touch another workspace.
Shared installation/repository records and recorded history remain available.

Webhook targets require an ACTIVE installation, an existing workspace connection,
an explicit repository grant and a connected, non-archived project. A shared
repository can fan out to several authorized projects. Task keys are matched
within each target project, including when workspaces use identical project keys.
Webhook delivery deduplication remains global; activity/notifications remain scoped.

GitHub suspension affects all connections to the installation. GitHub uninstall or
repository access removal revokes the affected grants and project links across
all connected workspaces, preserving history. Re-adding access on GitHub alone
does not silently reconnect projects. GitHub events never change task status.

## API additions

| Method | Path                                              | Purpose                                                           |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/github/install?workspaceId=...&mode=connect`    | Authorize an existing installation through GitHub                 |
| GET    | `/github/available-installations?workspaceId=...` | Current browser's verified, unexpired choices                     |
| POST   | `/github/connections`                             | Consume proof and connect `{ workspaceId, githubInstallationId }` |
| GET    | `/github/installations/:id/repository-access`     | Workspace editor candidates and `allowed` flags                   |
| PUT    | `/github/installations/:id/repository-access`     | Save `{ githubRepositoryIds: number[] }`                          |
| DELETE | `/github/installations/:id`                       | Disconnect this workspace only                                    |

All routes require authenticated workspace Admin/Owner access, except the
browser-bound GitHub callback. Unknown/foreign connections return 404. A workspace
admin cannot use another workspace's connection ID to connect a project.

## Migration and validation

Migration `0008_github_workspace_connections.sql` backfills the old installation
ID as the initial connection ID, preserving existing API IDs and project links.
Previously known repository IDs are preserved as initial grants and verified
candidates. Previously unknown repositories require reauthorization and explicit
selection. The canonical installation no longer cascades from workspace deletion.

Apply the migration through the normal database migration process before running
the updated API. The implementation does not itself migrate any live database.

Automated tests cover legacy migration preservation, GitHub user-scoped API calls,
state/replay/expiry/role checks, empty initial grants, foreign connection rejection,
different and shared repositories, identical task keys across workspaces, scoped
revocation/disconnection, retained history, lifecycle events and delivery deduplication.
The live GitHub authorization round trip still needs a smoke test with the registered App.

References: [GitHub user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[GitHub installation endpoints](https://docs.github.com/en/rest/apps/installations).
