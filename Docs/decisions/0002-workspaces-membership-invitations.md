# 0002 — Workspaces, membership, roles and invitations

- **Status:** Accepted (M2)
- **Date:** 2026-11-06
- **Scope:** Milestone M2 — architecture §6, §7.1, §8.2 and §9 (workspaces and invitations)

These rules were approved before implementation and are recorded here (§21 rule 12).

## 1. Workspace identity

- `slug` is generated from the name at creation. It is globally unique and **immutable**.
- If the slug is taken, a suffix is added: `-2` … `-9`, then a random suffix.
- The name can be changed (1–80 characters) by Admins and the Owner.

## 2. Owner protections

- Every workspace has **exactly one Owner**: the creator. The database enforces this with a partial unique index (`workspace_members_one_owner_idx`).
- `workspaces.owner_id` and the OWNER membership row are written in the same transaction.
- The Owner cannot be removed, demoted, or leave the workspace. The API returns `OWNER_PROTECTED`.
- No API grants OWNER. Validators accept only `ADMIN`/`MEMBER`, and a CHECK constraint (`invitations_role_not_owner`) blocks OWNER invitations.
- **Ownership transfer is not implemented.** It is not in the §9 API list. Adding it later needs a scope decision.

## 3. Role permissions

| Action                      | Owner | Admin                  | Member |
| --------------------------- | ----- | ---------------------- | ------ |
| View workspace, members     | ✓     | ✓                      | ✓      |
| Rename workspace            | ✓     | ✓                      | —      |
| Archive workspace           | ✓     | —                      | —      |
| Invite (as Admin or Member) | ✓     | ✓                      | —      |
| List / revoke invitations   | ✓     | ✓                      | —      |
| Change role of a Member     | ✓     | ✓ (to Admin or Member) | —      |
| Change role of an Admin     | ✓     | —                      | —      |
| Remove a Member             | ✓     | ✓                      | —      |
| Remove an Admin             | ✓     | —                      | —      |
| Leave the workspace         | —     | ✓                      | ✓      |

The matrix lives in pure functions in [`apps/api/src/workspaces/workspace-policy.ts`](../../apps/api/src/workspaces/workspace-policy.ts), with unit tests for every combination. The website keeps a copy only to decide which buttons to show; the API enforces the rules.

## 4. Invitations

- Tokens are 256-bit, single-use and expire after 7 days. Only the SHA-256 hash is stored.
- The link carries the token in the URL fragment, the same as M1 tokens: `/invitations/accept#token=…`.
- **Only the invited email can accept.** The signed-in user's verified email must equal the invitation email; otherwise the API returns `403 INVITATION_EMAIL_MISMATCH`. A forwarded link grants nothing.
- Accepting requires a verified email (the default M1 guard).
- **Re-inviting** an address revokes its previous open invitation in the same transaction. A partial unique index allows at most one open invitation per (workspace, email).
- Inviting an existing member returns `409 ALREADY_MEMBER`.
- Accepting is atomic: `UPDATE … WHERE accepted_at IS NULL AND revoked_at IS NULL RETURNING`. The membership insert ignores conflicts, so an existing member keeps their current role.
- Invitations to archived workspaces cannot be accepted.
- **New users:** the website keeps the token in `sessionStorage` for the current tab. The invitee can sign up, verify their email, and come back. A banner on signed-in pages links back to a pending invitation.
- **Rate limits:**

  | Action            | Limit                                      |
  | ----------------- | ------------------------------------------ |
  | Create invitation | 30/hour per user and 200/day per workspace |
  | Accept invitation | 20/15 min per user                         |
  | Create workspace  | 20/hour per user                           |

## 5. Deleting means archiving

`DELETE /workspaces/:id` sets `archived_at`. Only the Owner can do it. Archived workspaces:

- are excluded from `GET /workspaces`;
- return `404` from every workspace-scoped endpoint, for every member;
- cannot receive accepted invitations.

No data is deleted, and there is no unarchive endpoint yet.

## 6. Authorization layer and IDOR protection

- [`WorkspaceAccessService.require(userId, workspaceId, minimumRole)`](../../apps/api/src/workspaces/workspace-access.service.ts) is the single entry point for workspace authorization. Later modules (projects, tasks, GitHub) must use it.
- A non-member, a nonexistent workspace, an archived workspace and a malformed ID all return the **same 404**. A guessed UUID reveals nothing.
- A member whose role is too low gets `403`.
- Route UUIDs pass through `UuidParamPipe`, which maps a malformed ID to `404`, not `400`.
- `POST /invitations/:id/revoke` returns `404` to anyone outside the invitation's workspace.

## 7. API notes

- `GET /workspaces` and `GET /workspaces/:id/members` return plain arrays without cursor pagination. A user's workspaces and a team's members are small. Cursor pagination (§9) starts with tasks and activity feeds in M3/M4.
- `GET /workspaces/:id/invitations` returns **open** invitations only (pending or expired, not accepted or revoked), each with a computed `status`.
- New error codes: `OWNER_PROTECTED`, `ALREADY_MEMBER`, `INVITATION_INVALID`, `INVITATION_EMAIL_MISMATCH`, `INVITATION_NOT_PENDING`.

## 8. Reliability fixes found during M2

A smoke test against Neon exposed two defects that in-memory tests could not:

1. **The API crashed when Neon dropped an idle connection.** `pg.Pool` emits `'error'` when an idle connection fails (Neon closes connections during compute auto-suspend and on network interruptions). There was no listener, so Node treated it as fatal. `createDatabase` now always attaches a handler, and the API logs these errors as warnings. A regression test covers it.
2. **The error log hid the real cause and leaked query parameters.** Drizzle's `Failed query` error hides the driver cause (for example a connection timeout) and includes the **query parameters**, which can contain emails and password hashes. The exception filter now logs the `cause` chain and redacts `params:` lines (§14: never log secrets). This is covered by unit tests.

## Follow-ups

- **Transient errors are not retried.** A dropped connection fails that request with a 500. Consider a retry or circuit-breaker policy when deploying (M8).
- **Removing a workspace member** will need to cascade to project memberships (M3).
- **Possible later scope:** ownership transfer and unarchiving.
