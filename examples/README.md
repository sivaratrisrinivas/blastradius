# Example output

Committed, runnable output from the actual CLI and the actual Bright Data service, so a reader
can see the product's structured artifacts without running any commands.

| File | What it is | Provenance |
| --- | --- | --- |
| `brightdata-collector-output.json` | One row exactly as Bright Data's Scraper Studio returned it from the Slack collector. | Real: taken verbatim from `preview_result` in `fixtures/heal/awaiting-approval.progress.json`, a live capture from 19 Aug 2026 (see that file's own README for full provenance). `content`/`excerpt` are truncated with `...` because Bright Data's preview endpoint truncates long text fields for display; `retrievedAt`/`deadlineIso` serialize as `{}` in that same preview envelope — the adapter (`src/collection/bright-data.ts`) normalizes both before they reach the product's `vendor-notice` artifact. |
| `vendor-notice.json` | `blast collect` output: a validated, gated `vendor-notice` artifact. | Generated locally with `node dist/src/cli.js collect --fixture fixtures/slack-notice.json --output examples/vendor-notice.json`. The deterministic fixture carries the same field shape a live Slack collection returns. |
| `scan-result.json` | `blast scan` output: proven `CodeMatch`es and the `Impact` they produce. | Generated locally with `node dist/src/cli.js scan fixtures/repository --collection examples/vendor-notice.json --output examples/scan-result.json`. |
| `impact-report.html` | `blast report` output: the local HTML Impact Report for the Slack example. | Generated locally with `node dist/src/cli.js report --scan examples/scan-result.json --output examples/impact-report.html`. Open it directly in a browser. |
| `heal-detected.json` | `blast heal detect` output: the composed heal prompt naming the collapsed field, before Bright Data is contacted. | Generated locally from `fixtures/collector-health/required-field-collapse.json` (a `capabilityIdentifier: null` diagnostic) against the healthy `vendor-notice.json` above. |
| `heal-approved.json` | The `CollectorHeal` artifact after `heal run` reaches the approval gate and a human runs `heal approve`. | `heal run` and `heal approve` were replayed with `--recorded` against `fixtures/heal/awaiting-approval.progress.json` and `fixtures/heal/resumed-done.progress.json` — real Bright Data responses captured on 19 Aug 2026, not invented. `heal.diff.parseCodeBefore`/`parseCodeAfter` inside this file are Bright Data's actual proposed rewrite of the Slack collector's `parse_code`. |
| `impact-report-with-heal.html` | The same Impact Report, rendered with the real `parse_code` before/after diff at the approval gate. | Generated locally with `node dist/src/cli.js report --scan examples/scan-result.json --heal examples/heal-approved.json --output examples/impact-report-with-heal.html`. Open it and look at the "Proposed change to `parse_code`" section. |

Regenerate the `blast`-produced files any time with:

```bash
npm run build
node dist/src/cli.js collect --fixture fixtures/slack-notice.json --output examples/vendor-notice.json
node dist/src/cli.js scan fixtures/repository --collection examples/vendor-notice.json --output examples/scan-result.json
node dist/src/cli.js report --scan examples/scan-result.json --output examples/impact-report.html

node dist/src/cli.js collect --fixture fixtures/collector-health/required-field-collapse.json --output /tmp/collector-health.json || true
node dist/src/cli.js heal detect --diagnostic /tmp/collector-health.json --last-known-good examples/vendor-notice.json --output examples/heal-detected.json
node dist/src/cli.js heal run --heal examples/heal-detected.json --recorded fixtures/heal/awaiting-approval.progress.json --output /tmp/heal-gated.json
node dist/src/cli.js heal approve --heal /tmp/heal-gated.json --recorded fixtures/heal/resumed-done.progress.json --output examples/heal-approved.json
node dist/src/cli.js report --scan examples/scan-result.json --heal examples/heal-approved.json --output examples/impact-report-with-heal.html
```

None of this spends Bright Data credits: every command above replays a stored fixture or a
recorded response. `docs/brightdata-collection.md` covers the live paths (`collect --live`, a
live `heal run`) that do spend credits.
