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
