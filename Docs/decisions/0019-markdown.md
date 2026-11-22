# 0019 — Markdown in descriptions and comments

- **Status:** Accepted (user approval, 2026-11-22)
- **Date:** 2026-11-22
- **Scope:** Format task descriptions and comments
- **Builds on:** [0004](0004-collaboration.md) (comments, M4 rule 1: no injected markup)

## 1. Outcome

Task descriptions and comments are written in Markdown and shown formatted. Supported: headings, bold and italic, lists, task lists (`- [ ]`), tables, inline code and code blocks, links, quotes and rules (GitHub-flavoured Markdown).

## 2. Storage

There's no migration. The same text fields now hold Markdown. Existing plain text reads the same, except that line breaks inside a paragraph now join, as they do in Markdown.

## 3. Rendering and safety

- **Library:** `react-markdown` with `remark-gfm`, in `components/markdown.tsx`. It renders to React elements, never through `innerHTML`.
- **Raw HTML** in the text is dropped (`skipHtml`), never rendered.
- **Unsafe link targets** (`javascript:` and similar) are removed by react-markdown's default URL filter.
- **Links** open in a new tab with `rel="noopener noreferrer"`.
- **Task-list boxes** are read-only in the formatted view. The task checklist (0018) is the interactive version.
- **@mentions** the server resolved are highlighted as before, but not inside code or links.
- **Styles:** a `.dt-markdown` block in `globals.css`, written with design tokens only.

## 4. Editing

- **Description:**
  - Shown formatted.
  - Clicking the text (except on a link) or **Edit description** opens the editor, which has **Write | Preview** tabs and a "Markdown supported" hint.
  - **Done** returns to the formatted view.
  - The text still saves with the **Save changes** bar (SPEC §3).
- **Comments:** written as before. The hint now says "Markdown supported", and comments are shown formatted.

## 5. Tests

Website unit tests check that:

- GitHub-flavoured Markdown renders (headings, read-only task lists, tables, code);
- raw HTML, `<script>`, event handlers and `javascript:` links never appear in the output;
- links open in a new tab without opener or referrer;
- mentions are highlighted only when resolved, and never inside code.
