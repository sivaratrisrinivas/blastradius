# Bright Data collection

Blast Radius keeps Bright Data behind the public collection boundary. The live adapter sends one curated first-party vendor URL to a published Bright Data Scraper Studio collector. It never sends repository paths, source, snippets, symbols, CodeMatches, or scan artifacts.

Bright Data's Scraper Studio API requires both an API token and a published Collector ID. The token authenticates requests; the Collector ID selects the custom scraper to run. Create a collector in Scraper Studio, save it to production, and configure it to accept a `url` input.

The collector should return one JSON row with these fields:

```json
{
  "vendor": "Slack",
  "sourceUrl": "https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/",
  "retrievedAt": "2026-08-19T00:00:00Z",
  "content": "The files.upload method stopped functioning on November 12, 2025.",
  "excerpt": "The files.upload method stopped functioning on November 12, 2025.",
  "capabilityIdentifier": "slack.files.upload",
  "changeType": "shutdown",
  "deadlineOriginal": "November 12, 2025",
  "deadlineIso": "2025-11-12"
}
```

`sourceUrl`, `vendor`, and `retrievedAt` may be omitted by the collector: the adapter supplies the requested curated source and records retrieval time locally. `deadlineIso` must be `null` when the deadline wording is partial, relative, ambiguous, or ranged. The adapter accepts snake_case equivalents for collector output fields.

Set these values in the ignored root `.env` file:

```dotenv
BRIGHTDATA_API_KEY=your-api-token
BRIGHTDATA_COLLECTOR_ID=c_your-published-collector
BRIGHTDATA_COLLECTOR_VERSION=production
```

Run the live collection explicitly:

```bash
node dist/src/cli.js collect \
  --live \
  --vendor Slack \
  --output /tmp/blast-radius-demo/live-vendor-notice.json
```

The output is the same validated `vendor-notice` artifact produced by deterministic fixtures. It can be passed to the normal local scan and report commands:

```bash
node dist/src/cli.js scan fixtures/repository \
  --collection /tmp/blast-radius-demo/live-vendor-notice.json \
  --output /tmp/blast-radius-demo/live-scan-result.json
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/live-scan-result.json \
  --output /tmp/blast-radius-demo/live-impact-report.html
```

The collection boundary records `CollectorHealth` for the three supported signals only: zero results, required-field collapse, and schema failure. If one is observed, the command exits non-zero and stores a `collector-health` diagnostic containing the collector identity and version; the affected output is withheld from scanning and reporting. A healthy result means only those checks passed, not that the collector is semantically correct or complete.

The offline acceptance suite never contacts Bright Data. Run the narrow live contract check only when the API key and published collector ID are configured:

```bash
npm run test:brightdata
```

See the [Bright Data Scraper Studio API quickstart](https://docs.brightdata.com/datasets/scraper-studio/quickstart) for the published collector and trigger requirements.

## Self-healing a drifted collector

When `collect` records drift, `blast heal` drives Bright Data's own self-healing flow rather than swapping in a locally renamed collector. The API contract, verified against the live service on 19 August 2026:

| Step | Call |
| --- | --- |
| Start a heal | `POST /dca/collectors/{id}/refactor_template` with `{"prompt": "...", "custom_input": []}` |
| Poll | `GET /dca/collectors/{id}/refactor_template/progress` |
| Approve or reject | `POST /dca/collectors/{id}/resume_automation_job` with `{"message": true}` or `{"message": false}` |

Progress reports `status: "pending_answer"` with `step: "user_approval"` when the job pauses at the approval gate; that payload carries `diff.template_a` (current) and `diff.template_b` (proposed). The human-legible change is `steps[0].parse_code`. Resuming settles the job at `status: "done"`. Reaching the gate takes roughly two to three minutes.

The prompt is capped at 1000 characters and is composed from the detected `CollectorHealth` signal, never typed by hand:

```bash
node dist/src/cli.js heal detect \
  --diagnostic /tmp/blast-radius-demo/collector-health.json \
  --last-known-good /tmp/blast-radius-demo/vendor-notice.json \
  --output /tmp/blast-radius-demo/heal-detected.json
node dist/src/cli.js heal run \
  --heal /tmp/blast-radius-demo/heal-detected.json \
  --output /tmp/blast-radius-demo/heal-gated.json
node dist/src/cli.js heal approve \
  --heal /tmp/blast-radius-demo/heal-gated.json \
  --output /tmp/blast-radius-demo/heal-approved.json
```

`--last-known-good` takes a stored `vendor-notice` artifact from an earlier healthy collection, so the prompt can name the value the collapsed field last held.

`heal rerun --live` closes the loop against the real service: it re-collects from the curated source the drift was detected on, using the same credentials as `collect --live`, and fails if the collector drifts again.

Bright Data's API can approve and save a heal on its own. Blast Radius never uses those switches: the CLI rejects `--auto-approve` and `--auto-save`, and the resume request never carries `auto_save`. A template is saved only after an explicit human `heal approve`.

Adding `--recorded <progress.json>` to `heal run`, `heal approve`, or `heal reject` replays a captured progress payload instead of calling the API. The artifact then records `heal.source: "recorded"` and the report labels it as replayed. See [ADR-0003](adr/0003-collectorheal-calls-bright-data-tests-stay-offline.md) and `fixtures/heal/README.md`.

The offline acceptance suite replays those recorded payloads through a fake fetcher. The live heal contract starts a real job on the live collector and spends credits, so credentials alone do not enable it — it also needs `BLASTRADIUS_LIVE_HEAL=1`. It always ends in a rejection, leaving the collector untouched:

```bash
npm run test:brightdata                      # collection contract only
BLASTRADIUS_LIVE_HEAL=1 npm run test:brightdata   # also runs the live heal
```
