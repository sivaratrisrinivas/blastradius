# Blast Radius

Blast Radius is a local command-line tool that connects an official vendor notice to the code locations it can prove use the affected API or route.

Its most important rule is:

> Blast Radius may miss something it cannot prove; it must never present something it cannot prove as an Impact.

That rule controls every part of the product. A name that looks like a vendor API is not enough. The scanner must also prove which vendor and capability the code is using.

## What it does

The current MVP follows the same three-step path for three curated vendor changes:

| Vendor | Affected capability | Deadline |
| --- | --- | --- |
| Slack | `files.upload` | November 12, 2025 |
| OpenAI | Assistants API | August 26, 2026 |
| Cloudflare | Legacy Workers KV namespace routes | October 15, 2026 |

1. `collect` checks a saved copy of an official vendor notice and stores the parts that passed validation.
2. `scan` reads that result and checks one local JavaScript or TypeScript repository. It produces proven `CodeMatch` records and records related code it could not prove separately.
3. `report` creates a local HTML Impact Report only when the scan found at least one proven match. Unresolved code is shown as an analysis limitation, never as an Impact.

Repository scanning stays on the local machine. The offline examples use saved notice data, so repository source, paths, snippets, and scan files are never sent to an external service. The optional live collector sends only the selected public vendor URL to Bright Data; it never sends the local repository.

All three examples use the same offline commands. For Cloudflare, the scanner recognizes the old `/accounts/{account_id}/workers/namespaces/*` route and deliberately does not match the replacement `/storage/kv/namespaces/*` route.

This is intentionally a narrow MVP. It can miss code that it cannot prove, but it does not turn guesses into user-facing Impacts.

## Quick start

You need Node.js and npm.

Install dependencies and build the CLI:

```bash
npm install
npm run build
```

For the real-browser workflow check, install the WSL Chromium runtime once:

```bash
npx playwright install chromium
```

Collect the verified Slack notice:

```bash
mkdir -p /tmp/blast-radius-demo
node dist/src/cli.js collect \
  --fixture fixtures/slack-notice.json \
  --output /tmp/blast-radius-demo/vendor-notice.json
```

Scan the example repository:

```bash
node dist/src/cli.js scan fixtures/repository \
  --collection /tmp/blast-radius-demo/vendor-notice.json \
  --output /tmp/blast-radius-demo/scan-result.json
```

Create the local report:

```bash
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/scan-result.json \
  --output /tmp/blast-radius-demo/impact-report.html
```

Open `/tmp/blast-radius-demo/impact-report.html` in a browser. The report shows the source notice, its deadline, proven code locations, and analysis limitations in separate sections.

The OpenAI and Cloudflare examples use the same commands with their fixtures and repositories. Each one produces a local HTML report:

```bash
node dist/src/cli.js collect \
  --fixture fixtures/openai-notice.json \
  --output /tmp/blast-radius-demo/openai-notice.json
node dist/src/cli.js scan fixtures/repository-openai \
  --collection /tmp/blast-radius-demo/openai-notice.json \
  --output /tmp/blast-radius-demo/openai-scan.json
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/openai-scan.json \
  --output /tmp/blast-radius-demo/openai-impact-report.html

node dist/src/cli.js collect \
  --fixture fixtures/cloudflare-kv-notice.json \
  --output /tmp/blast-radius-demo/cloudflare-notice.json
node dist/src/cli.js scan fixtures/repository-cloudflare \
  --collection /tmp/blast-radius-demo/cloudflare-notice.json \
  --output /tmp/blast-radius-demo/cloudflare-scan.json
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/cloudflare-scan.json \
  --output /tmp/blast-radius-demo/cloudflare-impact-report.html
```

### Optional live Bright Data collection

The normal demo is offline and uses the saved fixtures above. The live path is an optional proof that one real Bright Data Scraper Studio collector can produce the same collection shape.

Put the Bright Data credentials and your published collector ID in the ignored root `.env` file:

```dotenv
BRIGHTDATA_API_KEY=your-api-token
BRIGHTDATA_COLLECTOR_ID=c_your-published-collector
```

Then run the live path explicitly:

```bash
npm run build
node dist/src/cli.js collect \
  --live \
  --vendor Slack \
  --output /tmp/blast-radius-demo/live-vendor-notice.json
node dist/src/cli.js scan fixtures/repository \
  --collection /tmp/blast-radius-demo/live-vendor-notice.json \
  --output /tmp/blast-radius-demo/live-scan-result.json
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/live-scan-result.json \
  --output /tmp/blast-radius-demo/live-impact-report.html
```

The adapter sends Bright Data only the selected curated public vendor URL. It validates the returned evidence before it can become a `CapabilityChange`. Repository source, local paths, snippets, symbols, `CodeMatch` records, and scan artifacts stay on the local machine. Run `npm run test:brightdata` for the narrow live contract check; the test is skipped unless both values are configured. See [docs/brightdata-collection.md](docs/brightdata-collection.md) for the collector output details.

Collection also records a deliberately limited `CollectorHealth` result. It detects only three forms of collector drift: zero results, required-field collapse, and schema failure. If one is detected, the command writes a `collector-health` diagnostic with the collector identity and version, exits non-zero, and withholds the affected output from scanning and reporting. A healthy record says only that those three checks passed; it does not claim that the scraper is semantically correct or that extraction is complete.

### Optional collector recovery

After the core Impact Report, the optional recovery workflow can diagnose a stored health failure and propose a new collector version. It validates that proposal against the same collection contract and the three supported health checks, but keeps the old collector active until explicit approval:

```bash
node dist/src/cli.js repair diagnose \
  --diagnostic /tmp/blast-radius-demo/collector-health.json \
  --output /tmp/blast-radius-demo/repair-proposal.json
node dist/src/cli.js repair validate \
  --proposal /tmp/blast-radius-demo/repair-proposal.json \
  --fixture fixtures/collector-health/healthy-repair-v2.json \
  --output /tmp/blast-radius-demo/repair-validated.json
node dist/src/cli.js repair approve \
  --proposal /tmp/blast-radius-demo/repair-validated.json \
  --output /tmp/blast-radius-demo/repair-activated.json
node dist/src/cli.js repair rerun \
  --proposal /tmp/blast-radius-demo/repair-activated.json \
  --fixture fixtures/collector-health/healthy-repair-v2.json \
  --output /tmp/blast-radius-demo/repair-recovered.json
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/scan-result.json \
  --repair /tmp/blast-radius-demo/repair-recovered.json \
  --output /tmp/blast-radius-demo/impact-report-with-recovery.html
```

Failed validation is stored as a non-activating repair artifact. An approval attempt without passed validation also fails without changing the active collector. A healthy rerun says only that the three supported checks passed; it does not claim autonomous or guaranteed repair.

If the scanner sees code it cannot prove, the scan still succeeds. It records the relative file path, line number, and a plain-English reason under `Analysis Limitations`. Those locations are not counted as proven matches. A repository with only unresolved usage has no Impact, but the limitation remains visible in the scan output and saved JSON file.

## How evidence works

A `CodeMatch` contains the vendor, capability identifier, repository-relative file, line number, evidence strength, context, and source line that supports the match.

Blast Radius creates an `Impact` only when the scan has one or more proven matches tied to the right vendor and capability. If it cannot prove a use, it records an analysis limitation instead. A repository with no proven match has no Impact, and the `report` command refuses to create a confirmed report.

An `Analysis Limitation` is different from a `CodeMatch`. It identifies code that looks related but that the local analyzer cannot prove. Computed or dynamic access, such as `slack[endpoint]` or `slack.files[method]`, is disclosed this way. A direct-looking call reached through an unsupported cross-file alias is also left unresolved. Neither case can create an Impact.

Before a notice can produce a `CapabilityChange`, `collect` applies the same proof-first rule to the notice itself. The candidate must come from the curated first-party source, explicitly name the affected capability, clearly connect that capability to a lifecycle event, and use a supported change type such as deprecation, sunset, shutdown, or removal. A candidate that fails one of these checks is withheld from `CapabilityChanges` and `Impacts`; it may still be kept as a diagnostic so the failed check is visible.

Blast Radius keeps the smallest supporting excerpt and the notice's original deadline wording. It normalizes a deadline only when the notice contains one complete, unambiguous date. Partial, relative, ambiguous, and ranged dates are not turned into invented precision. At report time, the supplied report clock labels the deadline as upcoming or past; if no precise date was stated, the report says that the date was not stated. An accepted capability change with no proven `CodeMatch` still produces no `Impact`.

For the Slack example, the scanner recognizes a direct call shaped like this:

```ts
import { WebClient } from "@slack/web-api";

const slack = new WebClient(token);
await slack.files.upload({ channels: channel, file });
```

The receiver must resolve to a `WebClient` imported from `@slack/web-api`. Comments, strings, unrelated identifiers, similarly named clients from other packages, method shape alone, shadowed bindings, reassigned bindings, and unsupported dynamic access do not become `CodeMatch` records. Those cases are either ignored or disclosed as limitations.

For OpenAI, the scanner proves `beta.assistants.create` calls whose receiver resolves to an OpenAI client imported from `openai` or loaded with `require("openai")`. It supports same-file aliases, destructuring, and assignment chains. Cross-file aliases, computed access, and other unsupported forms stay visible as limitations instead of becoming guesses. For Cloudflare, it proves exact legacy Workers KV namespace URL literals in source code and supported JSON/TOML configuration values. It does not match the replacement `/storage/kv/namespaces/*` route.

## Accessible local report

The HTML report presents one clear three-action workflow:

1. Verify the vendor notice.
2. Scan the local repository.
3. Open the Impact Report.

Each action has visible busy feedback. The workflow announces progress and asynchronous state to assistive technology, moves focus to the new screen heading, supports keyboard use and a skip link, and respects reduced-motion preferences. The report separates authoritative evidence, the capability change, deadline status, proven `CodeMatch` records, and Analysis Limitations.

## Current scan boundary

The MVP scans one repository with one root `package.json`. It analyzes JavaScript and TypeScript files (`.js`, `.jsx`, `.ts`, and `.tsx`) using local AST analysis and literal endpoint matching.

The scanner supports only the narrow, transparent paths defined for the three curated capabilities. It does not claim to understand every JavaScript construct, runtime reachability, generated code, workspaces, multiple languages, or dynamic API usage. It prefers an incomplete result over an unsupported Impact.

Repository contents remain local during scanning. The collection and scan artifacts are explicit JSON files so each boundary can be inspected and tested independently.

## Project layout

- `src/collection/` validates the committed vendor notice fixture.
- `src/collection/bright-data.ts` contains the opt-in public Bright Data collection adapter.
- `src/collection/repair.ts` records the diagnose, validate, approve, activate, and healthy-rerun recovery states.
- `src/scan/` walks the repository and produces proven CodeMatches and limitations.
- `src/domain/` defines and validates the versioned notice, scan, CodeMatch, Impact, CollectorHealth, and collector-repair artifacts.
- `src/report/` renders the local HTML Impact Report.
- `src/cli.ts` exposes the `collect`, `scan`, and `report` commands.
- `fixtures/` contains the vendor notices and small repositories used by the acceptance tests.
- `test/` verifies behavior through the compiled CLI and filesystem artifacts.
- `docs/product-contract.md` records the product rules and MVP boundary.
- `docs/adr/0001-separate-public-collection-from-local-analysis.md` records the privacy boundary.
- `tools/oxlint/anti-slop/` contains the local anti-slop lint plugin used by this repository.

The Issue #3 proof walkthrough is available at [docs/show-me-issue-3.html](docs/show-me-issue-3.html).

## Development checks

Run the build, typecheck, lint, real-browser check, and full acceptance suite before committing changes:

```bash
npm run build
npm run typecheck
npm run lint
npm run test:browser
npm test
```

The acceptance tests cover notice validation, assertion gates, deadline handling, collector-health drift signals, validated human-approved collector recovery, proven Slack/OpenAI/Cloudflare matches, aliases and assignment chains, decoys, dynamic access, cross-file aliases, limitation-only scans, report generation, the stored-result proof invariant, and the accessible three-action workflow plus optional recovery second act.

For the product rules and current scope, read [CONTEXT.md](CONTEXT.md) and [docs/product-contract.md](docs/product-contract.md).
