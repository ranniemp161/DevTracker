# DevTrack design-to-app gap review

Reviewed November 7, 2026. Review only; no application code changed.

The supplied design can guide a frontend-only polish pass. Preserve the existing framework, provider hierarchy, API contracts, authentication, permissions, database, realtime transport, and deployment configuration. UI composition and presentation may change; existing user actions and data semantics must remain intact.

This is a source and reference-image review, not a live-browser validation. The desktop reference screenshots, design specification, tokens, and corresponding frontend components were inspected. Mobile rendering, keyboard flows, and live multi-user behavior still require verification during implementation.

## Findings to resolve before implementation

### 1. The foundation instructions describe a different styling baseline

`design/SPEC.md` step 1 and `design/tokens.css` assume Geist is loaded and that the app uses legacy names such as `graphite`, `mineral`, and `accent`. This checkout's `apps/website/src/app/globals.css` uses a system font and neutral Tailwind colors; `components/ui.tsx` and feature components also use `neutral-*` extensively.

Copying the tokens alone will not produce the promised palette change. Load Geist and Geist Mono deliberately, wire the semantic tokens, then migrate existing component styles in the prescribed stages. Do not globally redefine Tailwind neutral colors to conceal the migration.

The token file defines typography and control sizes as CSS variables but does not map all of them into Tailwind utilities. For example, the spec's 13px secondary text and 14px default UI will not automatically become Tailwind's `text-sm` and `text-base`. Complete the necessary mappings before using those utilities. The existing nine-color label palette also has no exact one-to-one match with the eight supplied label tokens; preserve stored colors and account for custom API-provided colors without rewriting label data.

### 2. Task saving must retain all currently saved fields

In `features/projects/task-detail.tsx`, title, description, status, priority, and due date share one dirty-state check and explicit PATCH submission. Assignees and labels have separate actions. SPEC R1 mentions showing the Save bar only for title/description changes.

Keep explicit Save for all five existing form fields. The bar must appear for any of their changes, even when controls move to the properties panel. Discard must reset those draft fields only; it must not imply that previously completed assignee or label actions are undone. Keep failed-save values. Do not implement the screenshot's autosave claim.

A pre-existing concern: the editor uses `key={task.updatedAt}`, so a realtime refresh can remount it and replace an unsaved draft. Record and test this separately; do not silently change its synchronization model during a visual pass.

### 3. Moving Members into Settings can remove access

`ProjectMembers` allows project members to read the roster and restricts mutations through `viewerCanManage` and `readOnly`. `ProjectSettings` returns early for non-admins and archived projects. Redirecting every `/projects/[id]/members` visit to settings, as R5 proposes, would lose existing roster access.

For the visual pass, retain the accessible members route and navigation. Admin settings may reuse the members presentation, but a universal redirect should wait until the destination demonstrably preserves read access for ordinary members and archived projects. Do not relax mutation permissions to make the layout work.

### 4. Several screenshot details are not in the current data

- `Task` has no comment count or PR summary. Board card comment counts and board/list PR references cannot be filled from the currently loaded tasks.
- `Project` has `memberCount`, but no member list or task-completion counts. Project cards can show the real count and dates; they cannot render real member avatar stacks or completion percentages from this response alone.
- `Milestone` has no task linkage or progress counts. Omit progress as required by R3.
- `WorkspaceMember` has no project count. Omit the screenshot's per-member "2 projects" value.
- `ProjectMessageTaskRef` contains ID, key, title, and status, but no PR reference. Preserve linked-task cards without the screenshot's PR suffix.
- The board hook already loads all task pages, so a board completion summary can be derived from that complete set. Do not infer project totals from the list view's first page.

Use existing data and hide unsupported optional decorations. Avoid new per-card fetches or backend/schema changes merely to fill the mockup.

### 5. Some requested interactions exceed styling

The task timeline currently has separate comment and history components, each with its own pagination and realtime refresh. A single chronological timeline requires careful merging, pagination, and duplicate-event handling. Restyle the existing sections first; do not replace their data flow as a cosmetic change.

The task list is currently newest-first and cursor-paginated. Status grouping is a new presentation behavior: counts must describe loaded rows, and pagination must remain available. Activity category filters are also absent from the current feed UI; filtering only loaded entries must not pretend to search the entire history.

Per-column quick-add, custom status menus, and mobile drawers are feasible frontend interactions, but must preserve draft storage, keyboard access, existing mutations, and read-only behavior. Keep existing drag-and-drop in addition to accessible status controls.

### 6. The behavior specification is missing

`design/SPEC.md` and `CLAUDE.md` reference `Docs/ui-redesign-plan.md`, which is absent. `Docs/project-chat-and-ux-plan.md` exists but is a different document and still labels itself an unimplemented proposal despite chat code being present. Use actual code and the existing decision records to establish behavior; do not treat the missing file's acceptance criteria as reviewed.

The shell instructions also point to the route layout for removing project tabs, but the tab UI actually lives in `features/projects/project-context.tsx`. Keep its providers and realtime subscriptions intact while extracting presentation.

## Screen-by-screen gaps

| Area                     | Current implementation                                                                                       | Design target and bounded work                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundations and branding | System font, neutral palette, generic controls, text wordmark                                                | Geist/Geist Mono, pine semantic palette, brand SVG/favicon, consistent type scale, focus rings, radii and spacing.                                                                                                                         |
| Shared components        | Field, Select, Button, Badge, Card and Avatar exist                                                          | Restyle these first; add local outline icons, status dots/pills, priority bars, square label swatches, consistent empty/error/loading presentations. Preserve component callers and handlers.                                              |
| App shell                | Top header, centered `max-w-5xl` main, project tab strip                                                     | 248px sidebar, inset white main panel, breadcrumbs, active project subnavigation, mobile drawer and skip link. Retain workspace switching, notifications, sign-out, invitations, verification and access guards.                           |
| Board                    | Six compressed columns in a minimum-width grid, separate quick-add form, uppercase headings, priority badges | 272px lanes, softer canvas, roomier task cards, sentence-case headers, priority bars, compact status control, per-column add and overdue styling. Preserve sort order, optimistic rollback, filters and drafts.                            |
| Task detail              | Conventional form, separate assignee/label cards, comments and history split                                 | Larger borderless title/description, coherent properties panel, cleaner PR section and explicit Save bar. Keep all existing mutation boundaries and deletion confirmation. Unified timeline is a separate interaction item.                |
| List                     | Flat table with uppercase headers and horizontal scrolling                                                   | Quieter rows, mono keys, status dots, priority bars, clearer assignees, stacked mobile rows. Preserve cursor loading and Board/List filter query parameters. Grouping needs explicit handling of partial data.                             |
| Chat                     | Bordered panel using `100vh` subtraction and 500px minimum height                                            | Flexible dynamic-height panel, centered message column, refined date separators and task cards, pinned composer. Preserve drafts, mentions/IME handling, send/retry identity, read tracking, deep links, scrolling and reconnect behavior. |
| Milestones               | Always-visible creation form and one list                                                                    | Collapsible inline creation form, separate open/completed sections, flag icons, due-date emphasis, compact actions and empty completed state. Preserve completion/reopen/delete permissions. No progress bars.                             |
| Activity                 | Avatar-based flat feed with relative timestamps                                                              | Day headings, event-type icons, subtle dividers and aligned times. Preserve actor attribution, task links, realtime refresh and Load more. Category filtering is additional behavior.                                                      |
| All projects             | Two-column cards with key/name/status and member count                                                       | Responsive card grid, initial tiles, stronger title hierarchy, compact metadata footer and permission-aware creation tile. Preserve archived toggle and unread information; omit unsupported progress/avatar data.                         |
| Workspace overview       | Members/role/created summary cards at workspace root                                                         | Spec maps the workspace root to All projects. Preserve existing summary information and route reachability when deciding that navigation change.                                                                                           |
| Project settings         | Stacked General, Repository and Archive cards; Members separate                                              | Two-column settings sections, read-only key field, repository presentation and danger-zone treatment. Preserve typed archive confirmation and member-access distinction.                                                                   |
| Workspace members        | Invitation panel and member rows with existing permission checks                                             | Clearer invite form, pending-invitation state, avatar/identity hierarchy, role badges and labeled action buttons. Preserve owner protection, self-leave and role restrictions.                                                             |
| Workspace settings       | Stacked rename, labels, GitHub and archive cards                                                             | Two-column sections, visible read-only slug, refined label/installation rows and danger zone. Preserve GitHub callbacks and owner-only archive.                                                                                            |
| Authentication           | Centered bordered card with text branding                                                                    | Forest brand panel and centered form column; compact brand header on mobile. Reuse this shell across login/register/forgot/reset/verify without changing validation, redirects or OAuth URLs.                                              |

## Coverage outside the supplied screens

Apply the same primitives to the workspace chooser, create-workspace/project forms, invitation acceptance, email-verification notice, notifications, error screens and unavailable-resource states. These flows exist and should not retain a mismatched visual style simply because they lack dedicated screenshots. Preserve their existing contents and actions.

The desktop exports do not establish mobile behavior. Check 1440px, 768px and 360px against SPEC section 6. In particular, verify drawer focus trapping/return/Escape, toolbar wrapping, long task names and emails, table-to-row adaptation, and chat composer visibility with the mobile keyboard. Only board lanes and deliberately wide tables should scroll horizontally.

## Recommended rollout

Follow SPEC section 7, with a reviewable change per stage:

1. Foundations: load fonts, import tokens and complete necessary utility mappings.
2. Shared primitives: restyle existing controls and add the local icons/brand assets.
3. App shell: desktop sidebar and accessible mobile navigation, preserving providers and route access.
4. Board and filters: card hierarchy, lane spacing, real-data summary and accessible controls.
5. Task detail: presentation and Save bar first; keep timeline/data-flow changes separately scoped.
6. List, chat, milestones and activity: visual adaptation with pagination/realtime checks.
7. Settings, members, projects, authentication and ancillary flows: final consistency pass.

No backend, database, API-contract, authentication, realtime-transport or deployment change is needed for this bounded visual rollout. Unsupported sample-data details remain omitted.

## Verification during implementation

- Run formatting, lint, typecheck and the website production build at each completed stage. Keep unrelated working-tree changes untouched.
- Compare the changed screen with its reference; verify the mobile widths and keyboard operation.
- Exercise Save success/failure, property-only edits, filters across Board/List, status moves and rollback, quick-add drafts, pagination, and archived read-only views.
- Check owner/admin/member navigation and actions, especially the members/settings boundary.
- Exercise chat drafts, linked tasks, mentions, retries, deep links and realtime updates with the existing mechanisms.
- Do not add fake Search, My tasks or Inbox navigation; retain the functioning notification bell. Do not copy unsupported restore promises or sample counts.

No tests or builds were run for this review because application files were not modified. This document is the only file added by the review.
