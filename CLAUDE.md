# DevTrack

pnpm + Turborepo monorepo: `apps/website` (Next.js 16, React 19, Tailwind v4), `apps/api` (NestJS), `apps/realtime` (Socket.IO), shared code in `packages/*`. Architecture: `DEVTRACK_ARCHITECTURE.md`. Next.js in this repo has breaking changes, so read `apps/website/AGENTS.md` before writing frontend code.

## UI work: always follow the design kit

Any change to `apps/website` UI **must** follow [`design/SPEC.md`](design/SPEC.md).

- Use tokens from `design/tokens.css` only (via Tailwind utilities such as `bg-primary`, `text-fg-muted`, `border-line`, `rounded-card`). **Never** write raw hex/rgb or arbitrary values like `bg-[#0F6B55]` or `p-[13px]` in components. If a value is missing, add a token first.
- Don't add new usages of the legacy classes (`text-graphite`, `text-mineral`, `bg-accent*`, `bg-subtle`, `border-border`, `bg-canvas`). Replace them when you touch a file.
- Match the reference screen for the page you're working on: `design/screens/<screen>.html` (open in a browser) or `design/screenshots/<screen>.png`. The route → screen → file map is in SPEC §5.
- SPEC §3 (Reconciliation) overrides the mockups: explicit Save on task detail, status menu on board cards, no invented progress numbers, no fake Search/My tasks entries, respect permissions.
- Behavior contracts (saving, filters, chat, realtime, permissions, acceptance checks) come from `Docs/ui-redesign-plan.md`. A redesign must not change behavior.
- The screens use sample data. Never hardcode it.
- Build in the order of SPEC §7, one PR per step.

## Checks

```
pnpm format && pnpm lint && pnpm typecheck && pnpm --filter @devtrack/website build
```
