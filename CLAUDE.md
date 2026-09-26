
<!-- second-brain-kit:begin -->
## Second brain (`brain/`)

This project keeps a compiled knowledge base in `brain/` (Karpathy LLM-wiki pattern).
Read `brain/wiki/index.md` at the start of any non-trivial task, and `brain/CLAUDE.md` before writing to it.

- `brain/raw/`: source material (specs, client emails, call transcripts, incident notes, API docs). Append-only.
- `brain/wiki/`: pages the agent maintains: sources, entities (clients, integrations, services), concepts (decisions, patterns), synthesis.
- After a decision, incident or integration is settled, file it: drop the source in `brain/raw/` and run `/sb-ingest`.
- Health: `python brain/scripts/link_check.py brain` and `python brain/scripts/vault_stats.py brain`.
- The wiki is a dated snapshot. Verify live state before acting on anything it says about config or data.
- `brain/` must never be bundled, served or copied into a public build.
<!-- second-brain-kit:end -->
