# 0023 — Project leads and internal triage

- **Status:** Proposed (defaults chosen for the open questions in §9; confirm before building)
- **Date:** 2026-11-26
- **Scope:** Give each project people who are responsible for it (project leads), let team members propose work through Triage instead of adding it straight to the board, and send triage outcomes and blocked tasks to the people responsible, so a team can run its workflow inside DevTrack without a separate chat tool
- **Builds on:** [0002](0002-workspaces-membership-invitations.md) (workspace roles), [0003](0003-projects-and-tasks.md) (project access, tasks), [0004](0004-collaboration.md) (notifications), [0016](0016-request-form-and-triage.md) (request form and Triage), [0021](0021-status-automation.md) (accepting a request moves its task to To do)
- **Supersedes:** 0016 §4 "Who: anyone who can edit tasks in the project triages", and the 0016 §3 recipients of `REQUEST_SUBMITTED` (see §4)

## 1. Outcome

DevTrack follows the way a development team actually splits responsibility:

| Real-world role | In DevTrack                             | Responsible for                                                         |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| CTO / owner     | Workspace **Owner** or **Admin** (0002) | Every project, people, GitHub connections, workspace settings           |
| Project manager | **Project lead** (new, per project)     | Triage, priorities, the project's settings, milestones and request form |
| Developer       | **Project member** (0003)               | Assigned tasks, proposing work, reporting blockers                      |

Roles describe permissions, not job titles. One person can be Owner and lead and developer at once, which is normal in a small agency. A display-only **job title** (§7) lets a team show "CTO" or "PM" without it changing what anyone can do.

There is no "reports to" hierarchy between people. Responsibility attaches to work: a project has leads, a task has assignees.

## 2. Project leads

- **Data:** `project_members.role` is `'lead'` or `'member'` (default `'member'`). A project can have **any number of leads**, including none.
- **Who appoints:** workspace Owners and Admins, on the project's Members settings. A lead must already be a project member. Removing someone from the project removes their lead role with it.
- **What a lead can do** in that project, in addition to everything a member can:
  - triage requests and proposals (§4);
  - change project settings, including the request form and its link (0016 §2);
  - manage milestones (0003);
  - delete other people's tasks, comments and chat messages.
- **What stays with Owners and Admins only:** creating and archiving projects, adding and removing project members, appointing leads, linking GitHub repositories to the project (and syncing or unlinking them), and everything workspace-level in 0002. A lead's powers end at their project.
- **Seeing other projects stays with Owners and Admins.** A lead of one project sees no more of the workspace than any member: other projects return 404 and task relations into them stay hidden.
- **Owners and Admins keep every lead power on every project**, as today. Nothing they can do now is taken away.
- **Access layer:** `findProjectAccess` (`packages/server-core`) and `ProjectAccessService.require()` return two flags. `canManage` is `workspace role ≥ ADMIN OR project role = lead`, and `{ manage: true }` requires it. `isWorkspaceAdmin` is the workspace role alone; `{ admin: true }` requires it, and it alone decides whether other projects are visible.
- **API:** `PATCH /projects/:id/members/:userId { role: 'lead' | 'member' }` (Owners/Admins; 404 if the person isn't on the project) records `project.member_role_changed`. `GET /projects/:id/members` returns each member's `role`. `Project` gains `viewerCanManageMembers` (the admin flag) and `leads`; `viewerCanManage` is true for the project's leads, in the list too.
- **UI:** leads open project Settings, which hides the repository and archive sections from them. The Members section shows a Lead badge to everyone, and Make lead / Remove as lead buttons to Owners/Admins. The project header lists the project's leads.

## 3. Internal triage (per-project setting)

- **Setting:** `projects.internal_triage boolean NOT NULL DEFAULT false`, changed by leads and Admins in Project settings. Off keeps today's behavior exactly.
- **It only applies once the project has a lead.** Without a lead every member triages (§4), so members could accept their own proposals and the gate would mean nothing. Settings explains this when the project has no leads, and the API treats the setting as off until there is one.
- **When it's on:**
  - Members who aren't leads **propose** tasks instead of creating them. The "New task" control becomes "Propose task": a title, an optional description and a type (Bug or Request). Labels and attachments are added afterwards on the task, like on any task. Proposals land in the Backlog column.
  - A proposal creates a `BACKLOG` task with the member as reporter and no assignee, plus a `task_requests` row with `source = 'internal'`, `reporter_user_id` set and status `new`. The type attaches the same "Bug" or "Request" label as the form (0016 §3).
  - Leads, Owners and Admins still create tasks directly.
  - Subtasks of an accepted task, and tasks created by status automation or GitHub, are not proposals.
- **The API enforces it.** `POST /projects/:id/tasks` from a non-lead member on a project with internal triage in effect returns `403 PROPOSAL_REQUIRED`, and `POST /projects/:id/proposals { kind, title, description? }` is the route for them; it returns the new task's id. While internal triage isn't in effect, that route returns `409 INTERNAL_TRIAGE_OFF`, so there is no way to bypass the board or the gate. The website never relies on hiding the button.
- **What the website reads:** `Project.internalTriage` (the setting) and `Project.viewerMustPropose` (in effect, and the viewer isn't a lead or admin). The setting is changed with `PATCH /projects/:id { internalTriage }`.
- A proposal's activity entry is `task.created` with the member as actor and `source: 'proposal'`.
- **Turning it off** leaves open proposals in Triage until someone accepts or declines them. Turning it on changes nothing that already exists.

## 4. Triage

- **Who triages (supersedes 0016 §4), decided by whether the project has a lead (user answer, 2026-11-26):**
  - **No leads:** everyone who can edit tasks in the project triages, exactly as in 0016. This fits small teams where whoever is free triages.
  - **One or more leads:** only the project's leads and workspace Owners/Admins triage. This is the PM-style workflow, where the lead decides what gets done and who does it.
  - Developers who can't triage still help: they comment on a request's task (reproduce it, judge severity, point out duplicates) and the lead decides.
  - A team that rotates triage duty between developers makes the developer on duty a lead for that period. A separate triager role is out of scope (§8) until teams ask for it.
  - The rule is checked on every triage call, so appointing the first lead or removing the last one changes who triages at once.
- **One list for both sources.** The Triage tab shows form requests and internal proposals together. Each row has `source` (`form` or `internal`) and `reporter` (the proposing member, or null). It shows the reporter's name and email for the form (until deleted, 0016 §5), or the member's avatar and name for a proposal. A filter switches between All, Form and Team (`?source=form|internal`).
- **Accept** works as today: status `accepted`, `triaged_by`, `triaged_at`, and the task moves to To do (0021).
- **Decline** takes an optional reason (up to 500 characters, stored in `task_requests.decline_reason`) and soft-deletes the task as today (0016 §4). The request row stays.
- **The Triage tab** appears for anyone who can triage, with the count of `new` items. On a project with leads, other members don't see it. `Project` gains `viewerCanTriage` so the website doesn't have to work out the rule itself.
- **Who is told about new items (supersedes 0016 §3 recipients):** `REQUEST_SUBMITTED` goes to the project's leads. If the project has no leads, it goes to the workspace Owners and Admins who are project members, as today. A proposal never notifies its own reporter.

## 5. Telling the reporter

- An internal proposal's reporter gets a new **`REQUEST_TRIAGED`** notification when it is accepted or declined, unless they triaged it themselves. Accepted: "Accepted: <title>", linking to the task. Declined: "Declined: <title>" with the reason as the body, linking to the project's Triage route.
- **My proposals:** the reporter can open `GET /projects/:id/proposals?mine=true` (the only mode) to see their own proposals with status and reason, including declined ones whose task is deleted. Only the reporter and the people who triage can see a declined proposal. On the website, the Triage route shows "Your proposals" to people who can't triage, and members who must propose get a "Proposals" tab for it.
- `POST /requests/:id/decline` takes an optional `{ reason }`; Triage items carry `declineReason`. Migration `0024_proposal_outcomes` adds `task_requests.decline_reason` and the `REQUEST_TRIAGED` notification type.
- Form reporters are not notified. They have no account, and 0016 never emails them.

## 6. Blocked tasks reach the lead

- When a task moves into `BLOCKED` (by anyone), a new **`TASK_BLOCKED`** notification goes to the project's leads, or to the project's Owners/Admins if there are no leads, except the person who made the move.
- It reads "@dev marked DEV-12 as blocked", carries the task title as its body and links to the task, where the blocker is discussed in comments as today. Single edits and bulk edits both send it; status automation never moves a task into Blocked. Migration `0025_task_blocked` adds the notification type.
- Moving the same task into Blocked again within an hour doesn't send a second one.

## 7. Job title (display only)

- `users.job_title text` (up to 80 characters, optional), set in the user's profile.
- Shown next to the name in member lists, the project header's leads, and mention suggestions. It grants nothing.

## 8. Out of scope

- Direct messages, channels beyond project chat (0009), and daily digests.
- Approvals for anything other than new tasks (for example, a lead approving a status change).
- A reporting hierarchy between people.
- Letting leads add or remove project members. This can be reopened if teams ask for it.
- A separate triager role for developers on triage duty (§4).

## 9. Open questions (defaults used above)

1. **Proposing vs adding directly:** with internal triage on, non-leads must propose (default), or members choose between Propose and Add?
2. **Multiple leads per project:** allowed (default).
3. **Owners and Admins keep lead powers on every project:** yes (default).
4. **Declining:** an optional reason, the task soft-deleted, and the proposal kept visible to its reporter (default).

## 10. Migration (additive)

- `project_members.role text NOT NULL DEFAULT 'member'` with `CHECK (role IN ('lead', 'member'))` (migration `0022_project_member_roles`).
- `projects.internal_triage boolean NOT NULL DEFAULT false` (migration `0023_internal_proposals`).
- `task_requests` (`0023_internal_proposals`, except `decline_reason`):
  - `source text NOT NULL DEFAULT 'form'` with `CHECK (source IN ('form', 'internal'))`;
  - `reporter_user_id uuid` referencing `users`, set to NULL if the user is deleted;
  - `decline_reason text`;
  - a CHECK that internal rows have no `reporter_name`/`reporter_email`.
- `users.job_title text`.
- The `notification_type` enum gains `REQUEST_TRIAGED` and `TASK_BLOCKED`.

No existing data changes meaning: every project starts with no leads and internal triage off. Existing projects keep today's triage behavior until someone appoints a lead (§4). The migration runs against the shared database only after the user approves the SQL.

## 11. Build order (one PR each)

1. **Project leads:** schema, the access rule, appointing leads in Members settings, the Lead badge.
2. **Triage by leads:** the §4 permission change and the new `REQUEST_SUBMITTED` recipients.
3. **Internal proposals:** the setting, `POST /projects/:id/proposals`, `PROPOSAL_REQUIRED`, "Propose task", and source shown in Triage.
4. **Telling the reporter:** decline reason, `REQUEST_TRIAGED`, My proposals.
5. **Blocked reaches the lead:** `TASK_BLOCKED`.
6. **Job title.**

## 12. Tests

The end-to-end tests run on PGlite and cover:

- the access matrix: lead, member, Admin and Owner on lead-only and Admin-only actions, including a lead of another project;
- appointing and removing leads, and lead role removed with membership;
- internal triage off (unchanged behavior) and on (`PROPOSAL_REQUIRED`, proposals created, leads still create directly);
- triage permissions for both sources, accept moving to To do, decline with and without a reason;
- `REQUEST_SUBMITTED`, `REQUEST_TRIAGED` and `TASK_BLOCKED` recipients, with and without leads, and the one-hour repeat rule;
- a declined proposal visible to its reporter and to triagers only.
