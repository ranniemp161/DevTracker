# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: the project's domain vocabulary.
- **`Docs/decisions/`**: the decision records (ADRs). Read the ones that touch the area you're about to work in. Each record says which earlier records it supersedes; the newer one wins.
- **`DEVTRACK_ARCHITECTURE.md`**: the system architecture, referenced by section number (for example §11.2) from code comments and decision records.

If `GLOSSARY.md` doesn't exist yet, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved.

## File structure

Single-context repo: one vocabulary across `apps/*` and `packages/*`.

```
/
├── GLOSSARY.md
├── DEVTRACK_ARCHITECTURE.md
├── Docs/
│   ├── agents/          ← this configuration
│   └── decisions/
│       ├── 0001-authentication-and-sessions.md
│       ├── ...
│       └── 0021-status-automation.md
├── apps/
└── packages/
```

## Writing a new decision record

- Put it in `Docs/decisions/`, not `docs/adr/`.
- Continue the numbering: the next free four-digit number, then a kebab-case slug (`0022-repository-access.md`).
- Follow the existing records' header: `# NNNN - Title`, then `- **Status:**`, `- **Date:**` (YYYY-MM-DD) and, when it replaces earlier decisions, `- **Supersedes:**`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision-record conflicts

If your output contradicts an existing decision record, surface it explicitly rather than silently overriding:

> _Contradicts decision record 0010 (shared GitHub connections), but worth reopening because…_
