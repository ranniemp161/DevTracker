# 0027 — Workspace overview of client deliveries

- **Status:** Accepted (user answers, 2026-11-28)
- **Date:** 2026-11-28
- **Scope:** One page where a business owner sees every delivery in flight across the workspace's projects, without opening each project
- **Builds on:** [0013](0013-my-tasks.md) (workspace-wide views), [0023](0023-project-leads-and-internal-triage.md) (project leads), [0025](0025-milestone-stages-and-scope.md) (stages, added after start, ready for client review), [0026](0026-milestone-github-releases.md) (linked releases)

## 1. Outcome

`/workspaces/[id]/overview` lists the workspace's undelivered milestones, real numbers only:

- **Active** and **Client review** sections, then **Planned** in its own section. Delivered milestones are left out; they're on each project's Milestones page.
- Inside each section, milestones are grouped by project.
- Each milestone shows: its stage, due date (with **Overdue** when past and not delivered), done/total tasks, tasks added after start (once started), linked releases, and **Ready for client review** when an Active milestone has every task Done and every criterion ticked (the same rule as 0025 §4).
- Each milestone links to its project's Milestones page; each project name links to the project.

Nothing on the page can be edited: changes happen where they do today.

## 2. Who sees it (user answer: recommended)

- **Workspace Owners and Admins:** every project that isn't archived.
- **Project leads:** only the projects they lead.
- **Everyone else:** no Overview. `GET` returns `403`, and the sidebar doesn't show the entry.
- `WorkspaceSummary` (and so the workspace details) gains `viewerCanSeeOverview` (admin, or a lead of at least one unarchived project) so the website doesn't work the rule out itself.

## 3. Where it lives (user answer: recommended)

A new **Overview** entry in the sidebar, above **My tasks**, shown only to people who can see it. The workspace home page is unchanged.

## 4. API

`GET /api/v1/workspaces/:id/overview` returns `{ sections: { stage, projects: { project: { id, key, name }, milestones: Milestone[] }[] }[] }`, sections in the order Active, Client review, Planned, and only sections that have milestones.

- `Milestone` is the same shape as the Milestones page (counts, criteria, releases), so readiness and the added-after-start count are computed the same way.
- **Order:** projects by name; milestones overdue first, then by due date (undated last), then name.
- A non-member of the workspace gets the same `404` as a missing workspace.

## 5. Not included (user answer)

- Logged time against estimates per milestone (0012 still excludes reports).
- Editing, filters, exports, charts or percentages beyond the real done/total count (SPEC §3).

## 6. Tests

End-to-end on PGlite:

- an admin sees every unarchived project's undelivered milestones, sectioned and ordered; delivered and archived are left out;
- a lead sees only their projects; a member gets `403` and `viewerCanSeeOverview: false`; an outsider gets `404`;
- counts, added-after-start and releases match the Milestones page.

No migration.
