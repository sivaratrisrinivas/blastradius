# CLI reference

`blast check` is the entry point and runs the three explicit commands for you. Use the explicit
form when you want one capability, one artifact, or one stage at a time.

Examples below assume `npm link`, which installs the `blast` binary. Without it, substitute
`node dist/src/cli.js`.

## check

```bash
blast check <repo>                       # every matched capability against one repository
blast check <repo> --report-dir reports/ # one HTML Impact Report per impacted capability
blast check <repo> --output combined.json # one JSON artifact holding every scan of the run
```

Exits 0 whether or not it finds an Impact, because an Impact is a finding, not a failure. Works
from any directory: the bundled vendor notices resolve next to the installed tool rather than next
to you.

```bash
blast check fixtures/repository-multi-vendor  # three Impacts: Slack, OpenAI, Cloudflare
blast check fixtures/repository-clean         # zero Impacts, no report written
```

## collect

Turns one official vendor page into a stored, gated JSON artifact.

```bash
blast collect --fixture fixtures/slack-notice.json --output /tmp/blast/notice.json
```

If collection detects collector drift, the command exits non-zero and withholds the affected output
rather than passing a broken row downstream.

## scan

Reads one notice and inspects one local repository, producing exact `file:line` matches plus
separately recorded Analysis Limitations.

```bash
blast scan fixtures/repository --collection /tmp/blast/notice.json --output /tmp/blast/scan.json
```

## report

Renders one scan as local HTML. With no proven CodeMatch there is no Impact and no confirmed
report.

```bash
blast report --scan /tmp/blast/scan.json --output /tmp/blast/report.html
blast report --scan /tmp/blast/scan.json --heal heal-rerun.json --output report.html
```

`--heal` adds the line-level collector template diff shown at the approval gate.

Two more end-to-end examples ship with the repository: swap in `fixtures/openai-notice.json` with
`fixtures/repository-openai`, or `fixtures/cloudflare-kv-notice.json` with
`fixtures/repository-cloudflare`.

## Live collection

The default path uses local fixtures and needs no credentials. The live path proves a real Scraper
Studio collector produces the same shape of data.

```dotenv
BRIGHTDATA_API_KEY=your-api-token
BRIGHTDATA_COLLECTOR_ID=c_your-published-collector
```

```bash
blast collect --live --vendor Slack --output /tmp/blast/live-notice.json
```

`--vendor` accepts any of the 10 curated vendors, and each has its own collector, because one
collector holds one parse template written for one page's structure. The adapter sends Bright Data
only the selected public vendor URL and never sends repository contents. Credentials are read from
`.env` in the current directory.

Per-vendor variables and the collector-creation recipe: [brightdata-collection.md](brightdata-collection.md).

## heal

`blast heal` only appears when `collect` detects a drifted collector. It drives Bright Data's own
self-healing endpoint through a human-approval gate, so the vendor's AI rewrites the template
rather than a local guess.

```text
detect -> compose prompt -> heal -> await approval -> approve or reject -> healthy rerun
```

```bash
blast heal detect --diagnostic <collector-health.json> --last-known-good <notice.json> --output heal-detected.json
blast heal run --heal heal-detected.json --output heal-gated.json
blast heal approve --heal heal-gated.json --output heal-approved.json
blast heal rerun --heal heal-approved.json --fixture fixtures/collector-health/healed-rerun.json --output heal-rerun.json
```

The collector keeps running its current template until a person explicitly approves the proposal.
`--auto-approve` and `--auto-save` are refused everywhere in the CLI. A rejected proposal leaves the
collector exactly as it was. An approved one reruns and either reports healthy or, if the collector
drifts again, fails honestly rather than claiming success. Healing moves a collector's template,
never its identity.

`heal run` takes two to three minutes and spends credits live, or replays a recorded response with
`--recorded fixtures/heal/awaiting-approval.progress.json`. The resulting artifact is marked
`heal.source: "recorded"`, so replayed evidence is never shown as a live call.
