# AI assistance disclosure

Blast Radius was built with Claude Code (Anthropic's agentic coding CLI) as a pair-programming
tool, issue by issue, under my direction and review throughout. This is a factual account of how,
not a claim of authorship for the ideas — the product decisions, spec, and final say on every
change are mine.

## What the AI did

- **Implementation.** Every source file under `src/`, `test/`, and `tools/oxlint/anti-slop/` was
  written by Claude Code against a written issue (tracked in this repo's GitHub Issues, see
  `docs/agents/issue-tracker.md`) and this repo's coding standards, typically test-first.
- **Documentation.** The README, `CONTEXT.md`, `docs/product-contract.md`, the ADRs under
  `docs/adr/`, and this file itself were drafted by Claude Code and edited by me.
- **This submission.** The `examples/` directory, the eval table generator invoked by
  `npm run metrics`, and the final submission assembly for issue #15 were produced the same way.
- Commits carry `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` where the AI wrote the
  change; `git log` is the authoritative record of which commits that applies to.

## What was not delegated

- **The spec and every product decision.** The problem statement, the proof-first invariant
  ("Blast Radius may miss something it cannot prove; it must never present something it cannot
  prove as an Impact"), the three curated matched vendors, and every ADR decision originated from
  me and were recorded as issues before implementation started.
- **Reviewing and approving every change.** Nothing merged without my review; every collector
  built against the live Bright Data API, every credit-spending run, and every `heal approve` /
  `heal reject` decision was mine to make, not the AI's — the product itself refuses to let an AI
  approve a heal (`--auto-approve` and `--auto-save` are rejected everywhere in the CLI, the same
  standard applied to how this repo was built).
- **Finding the nine additional first-party vendor deprecation pages** used for `WatchedVendor`
  coverage (issue #13) — that research was mine.
- **Recording the demo video and this written submission's final wording** are mine.

## Why this disclosure exists

Required by the hackathon's submission checklist (issue #15); omitting it risks disqualification.
Full accuracy matters more than brevity, so this errs toward naming specifics (which files, which
issues) over a general statement.
