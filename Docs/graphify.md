# Local codebase navigation with Graphify

Graphify maps source symbols and their relationships for codebase exploration.
The project includes its Codex skill under `.codex/skills/graphify/` and graph-first
navigation guidance in the root `AGENTS.md`.

Install the CLI in an isolated tool environment (Python 3.10+ and uv required):

```powershell
uv tool install "graphifyy[sql]==0.9.97"
```

Build the local code graph and report, without an LLM or API key:

```powershell
graphify extract . --code-only
graphify cluster-only . --no-label
graphify export html
```

Generated files live in `graphify-out/`, which is excluded by `.gitignore`:

- `graph.html`: interactive graph to open locally.
- `graph.json`: relationships used by queries.
- `GRAPH_REPORT.md`: architecture summary.

Use the graph from the repository root:

```powershell
graphify query "GitHub installation workspace" --budget 1500
graphify explain "GithubModule"
graphify update .
```

Run `graphify update .` after source changes. Rebuild the HTML with
`graphify export html` when needed.

The graph indexes code, including SQL migrations; it does not semantically index
documentation or prove application behavior. Extraction can omit unsupported
symbols or files flagged as sensitive, so verify important findings against source.
Do not commit generated graphs, reports, HTML, or caches.

Upstream installation reference: <https://github.com/Graphify-Labs/graphify>.
