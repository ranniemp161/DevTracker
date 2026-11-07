# DevTrack UI redesign plan

Date: 2026-11-07
Status: Proposed implementation plan. No UI changes made in this planning pass.

## Purpose and source of truth

Make DevTrack feel like a considered engineering workspace: clear navigation, readable tasks, useful density, and polished collaboration surfaces.

This plan follows the redesign-existing-projects skill and reviews `project-chat-and-ux-plan.md`, `handoff.md`, the architecture document, and the current frontend source. The earlier chat plan explicitly deferred a full visual redesign and preserved the system font and neutral palette. This new request opens that visual scope; its authorization, data, chat, and task workflow contracts remain in force.

The audit below is grounded in current source. Browser observations from the preceding debugging session are supporting context, not a new responsive visual review. Capture fresh browser baselines during implementation.

## Audit findings

| Finding                               | Evidence                                                                                                               | Design response                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Work surfaces are too narrow          | `app-shell.tsx` constrains every page to `max-w-5xl`; `board.tsx` fits six columns into a 1080px minimum grid          | Give Board and List a wider workspace; retain narrow reading widths for forms                       |
| Styling lacks a distinctive hierarchy | `globals.css` has only a system font and neutral body colors; `ui.tsx` repeats neutral borders, pills, and backgrounds | Introduce semantic tokens, a clear type scale, one brand accent, and purposeful surface levels      |
| Board cards are cramped               | Small task keys, 11px status selects, and multiple metadata elements compete in narrow columns                         | Use 260–300px columns, stronger titles, restrained metadata, and a compact accessible status action |
| Controls compete with the work        | Separate filter and quick-add rows, seven equal-weight project tabs                                                    | Organize a project header, navigation, and compact task toolbar with one clear creation action      |
| Chat sizing is brittle                | `chat-view.tsx` combines `100vh` subtraction with a 500px minimum height                                               | Use a viewport-aware flex layout with a bounded history area and reachable composer                 |
| Loading and recovery feel unfinished  | Several screens show plain loading text; session errors have no in-page retry                                          | Add matching skeletons and explicit recovery actions                                                |
| Mobile panels need constraints        | Notification panel has a fixed `w-80`; navigation and board require horizontal scrolling                               | Constrain overlays to viewport gutters and isolate intentional scrolling to the board or tab strip  |

## Visual direction

Use a quiet, precise light theme with graphite text, soft mineral-gray surfaces, and a deep teal accent. Typography and layout should provide most of the identity.

- Typeface: Geist Sans for interface text, using a local or build-managed asset; system fallback. Monospace or tabular figures for task keys and counts. Confirm font availability before implementation.
- Proposed palette: canvas `#F5F7F7`, surface `#FFFFFF`, subtle surface `#EDF2F1`, primary text `#182622`, secondary text `#53655F`, border `#DCE4E0`, accent `#176B5B`, accent tint `#E7F2EE`. Verify text and control contrast before locking tokens.
- Semantic status colors remain distinct from the brand accent: amber for warnings, red for errors, green for completion. Always pair color with text or an icon.
- Type scale: 28–32px page titles, 18–20px section titles, 14px interface text, 12px supporting metadata. Avoid tiny primary controls.
- Spacing: a 4px base, 16–24px component spacing, 24–32px page gutters on desktop and 16px on mobile.
- Shape: 8px controls, 12px task cards, 16px major panels. Reserve shadows for floating panels and subtle card lift.
- Icons: a small consistent outline set with accessible names. Check dependencies first; do not add a large library for a few icons.
- Motion: short 120–180ms color/opacity transitions with reduced-motion support. Keep native scrolling and stable content positioning.

## Screen and interaction design

### 1. App shell and navigation

Retain the existing top navigation to preserve familiar routes. Give the brand, workspace switcher, notifications, and account controls deliberate spacing and consistent sizing. Add a skip-to-content link and clear workspace/project breadcrumbs.

Use a shared page header: breadcrumb, project key/name, status, then navigation. Keep all existing routes reachable. Visually group Board and List as related views while retaining their URLs, filters, and active-state semantics; Chat, Milestones, and Activity remain prominent destinations. Members and Settings remain available and respect existing permissions.

Use up to approximately 1600px for work surfaces, 1100–1200px for overview pages, and 640–760px for focused forms. At narrow widths, wrap the header cleanly and use an independently scrollable project navigation strip.

### 2. Workspace and project overview

Create a clear page title, short context line, and permission-aware creation action. Present projects as scannable rows or restrained cards with name, key, status, description, member count, target date, and unread chat count where available.

Use existing API fields only. Do not invent completion percentages, activity charts, or aggregate counts. Distinguish an empty workspace from a failed request and provide the appropriate next action.

### 3. Board and list

Build a common toolbar for filters and task creation. Use compact labelled controls, visible active filter values, and a clear reset action. Keep filter parameters intact when changing views. On mobile, allow the filters to expand from a labelled disclosure with an active-filter count.

Give each board column a status marker, sentence-case name, count, and quiet surface. Columns keep a readable width and scroll inside the board, without causing page-level overflow. Empty columns get a small contextual message.

Task cards prioritize title, then key, labels, and a footer for priority, assignees, and due date. Keep status changes keyboard- and touch-accessible; they must not depend on hover or drag-and-drop. Preserve optimistic updates, rollback, and read-only archived states.

Keep quick creation visible and compact, with retained drafts and clear pending/error feedback. Improve List as aligned rows on desktop and readable stacked items on mobile, using the same task/status vocabulary.

### 4. Task details

Keep the existing task route and explicit Save behavior. Organize the desktop page into a main reading/editing column and a properties panel. Group title/description, discussion, GitHub links, and history separately; group status, priority, dates, assignees, and labels in the properties area.

On mobile, stack properties and content with a reachable Save action. Keep “Discuss in chat” visible as a secondary action. Preserve unsaved values on failure and show confirmation when saving succeeds. Avoid introducing a drawer/navigation rewrite in this pass.

### 5. Project chat

Compose chat as a dedicated conversation surface: compact context header, flexible scrollable history, and bottom composer. Use dynamic viewport sizing and test the mobile keyboard rather than relying on a hard-coded minimum height.

Improve message spacing, author/timestamp hierarchy, date dividers, mention treatment, and linked-task previews. Keep Edit/Delete discreet but discoverable through keyboard focus and touch. A linked task should read as a compact task reference, not a second large card.

Give the composer a clear input boundary, task attachment control, primary Send action, and concise keyboard hint. Preserve mention suggestions, drafts, composition-input behavior, optimistic sends, original retry IDs, deep links, scroll anchoring, and read tracking. Show connection and send failures near the affected action.

### 6. Notifications and shared states

Constrain the notification panel to the viewport. Use a clear unread marker, readable timestamps, and obvious navigation targets. Preserve separate bell-read and chat-read semantics.

Introduce shared skeleton, empty-state, and error/retry patterns. In particular, a temporary session/API failure should offer a Retry button instead of leaving the user on a dead-end message. Reuse these patterns in project, task, and chat screens.

### 7. Remaining screens

Apply the same components and spacing to Milestones, Activity, Members, Settings, and authentication pages. Keep destructive operations visually separate, retain confirmations, and preserve role-sensitive actions. This is a consistency pass, not a new product feature set.

## Implementation sequence

1. **Baseline and foundation:** capture current pages at 360px, 768px, and 1440px; read applicable Next.js local guidance; add tokens, typography, icons, and shared component states.
2. **Shell and flagship workflow:** redesign app/project headers, Board, filters, List, and task creation. Review the visual direction here before spreading it across the app.
3. **Collaboration:** redesign task details, Chat, composer, and notifications while preserving their state and mutation behavior.
4. **Consistency:** update workspace/project overviews and the remaining forms and management screens.
5. **Acceptance:** perform responsive and keyboard checks, run relevant repository checks, and document evidence and remaining limitations.

Primary files: `apps/website/src/app/globals.css`, `app/layout.tsx`, `components/ui.tsx`, `features/session/app-shell.tsx`, `features/projects/*`, `features/chat/*`, `features/workspaces/*`, and `features/collaboration/*`.

Work incrementally within the existing Next.js, React, and Tailwind v4 stack. Preserve the current uncommitted feature work. Backend/API/schema changes are not expected. Do not deploy as part of the redesign.

## Acceptance criteria

- A clear visual hierarchy identifies the current workspace, project, view, and primary action.
- Board cards remain readable without squeezing six columns into a narrow container.
- At 360px, 768px, and 1440px, no unintended page overflow occurs; only designated board/tab regions scroll horizontally.
- Primary touch actions have approximately 44px hit areas; keyboard navigation has visible focus, sensible order, labelled controls, and no traps.
- Text meets WCAG AA contrast targets; status is understandable without color. Reduced motion is honored.
- Long project names, task titles, usernames, labels, messages, and empty data are handled without clipping essential controls.
- Filters survive Board/List navigation; task creation, status updates, explicit saving, and archived permissions retain existing behavior.
- Chat mentions, task links, retry, editing/deletion, unread state, and deep links continue working. Run two-session checks when changing behavior affecting realtime/read state.
- Loading, empty, permission-denied, disconnected, and failed-save states are usable; Retry recovers from a temporary API outage.
- Use existing records for read-only visual checks and isolated test data for mutation checks.
- Run frontend formatting, lint, typecheck, and production build. Run affected functional tests when behavior changes; avoid adding tests that only mirror CSS classes.
- Record browser screenshots and a short keyboard/responsive review in the handoff. Distinguish verified behavior from untested assumptions.

## Deferred scope

Dark mode, global search, command palettes, custom dashboards, new analytics, new chat features, and backend changes are separate work. Complete the daily task and collaboration experience first.
