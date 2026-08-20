# Project layout

| Path | Responsibility |
| --- | --- |
| `src/collection/` | Validates stored vendor notice fixtures. |
| `src/collection/bright-data.ts` | Opt-in public Bright Data collection adapter. |
| `src/collection/heal.ts` | Detect, compose a prompt, heal, approve or reject, and rerun. |
| `src/collection/bright-data-heal.ts` | Bright Data self-healing adapter and the recorded-response replay seam. |
| `src/scan/` | Produces proven CodeMatches and Analysis Limitations. |
| `src/domain/` | Defines and validates versioned JSON artifacts. |
| `src/report/` | Renders the local HTML Impact Report. |
| `src/report/line-diff.ts` | Turns two collector templates into the line diff shown at the approval gate. |
| `src/check/` | Composes one scan per matched capability into a single `check` run. |
| `src/cli.ts` | Exposes `check`, `collect`, `scan`, `report`, and `heal`. |
| `src/metrics/` | Re-runs the fixture suite to compute the eval table and write it into the README. |
| `fixtures/` | Vendor notices and small repositories used by tests. |
| `fixtures/repository-multi-vendor/` | The demo repository: uses all three matched capabilities at once. |
| `fixtures/repository-clean/` | A repository using none of them, so `check` has an honest zero-Impact case. |
| `fixtures/heal/` | Real Bright Data healing responses, recorded once and replayed offline. |
| `fixtures/watched/` | First-party notices for the watched vendors, with provenance for every excerpt. |
| `examples/` | Committed structured output from every stage. |
| `scripts/demo.sh` | Types each demo beat's real command and waits for a keypress between them. |
| `scripts/demo-reset.sh` | Restages `/tmp/blast-demo` so every recording take starts identical. |
| `test/` | Acceptance, browser, and focused rule tests. |
| `docs/cli.md` | Full command reference. |
| `docs/vendor-coverage.md` | The matched and watched vendor tables. |
| `docs/product-contract.md` | Product rules and MVP boundary. |
| `docs/brightdata-collection.md` | Per-vendor variables and the collector-creation recipe. |
| `docs/demo-runbook.md` | How to record the demo video. |
| `docs/adr/` | The decisions behind the design, and why each one was made. |
| `docs/ai-assistance.md` | Disclosure of how AI was used to build this. |
| `CONTEXT.md` | Domain vocabulary and definitions. |
| `tools/oxlint/anti-slop/` | Local anti-slop Oxlint plugin. |
