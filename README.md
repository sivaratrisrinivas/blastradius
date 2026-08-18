# Blast Radius

Blast Radius connects an authoritative third-party API shutdown notice to the code locations it can prove use the affected capability.

The project is deliberately cautious:

> Blast Radius may miss something it cannot prove; it must never present something it cannot prove as an Impact.

That rule is the most important part of the product. A name that looks like a vendor API is not enough. The scanner must also prove the vendor and capability behind the call.

## What the prototype does

The current command-line prototype demonstrates Slack's `files.upload` shutdown:

1. `collect` validates a committed, first-party Slack notice fixture and writes a versioned `VendorNotice` artifact.
2. `scan` reads that notice and scans one local JavaScript or TypeScript repository for proven uses of `slack.files.upload`. It prints proven `CodeMatch` records and unresolved uses in separate sections.
3. `report` creates a local HTML Impact Report, but only when the scan contains at least one proven `CodeMatch`. When limitations exist, the report shows them in their own section.

The repository scan stays on the local machine. The current demonstration uses stored fixture data for the vendor notice; it does not send repository source, paths, snippets, or scan artifacts to an external service.

The product contract also describes future notice examples for OpenAI and Cloudflare. The end-to-end CLI path currently implemented in this repository is the Slack example.

## Quick start

You need Node.js and npm.

Install dependencies and build the CLI:

```bash
npm install
npm run build
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

Open `/tmp/blast-radius-demo/impact-report.html` in a browser. The report shows the source notice, its deadline, the proven code location, and any analysis limitations in separate sections.

If the scanner finds usage that it cannot prove, the scan still succeeds. Its output includes an `Analysis Limitations` section with the repository-relative file, one-based line number, and a plain-English reason. Those locations are not counted as proven matches. A repository with only unresolved usage therefore has no Impact, but the limitation is still visible in the scan output and stored JSON artifact.

## How evidence works

A `CodeMatch` contains the vendor, capability identifier, repository-relative file, line, evidence strength, context, and source line that supports the match.

Blast Radius creates an `Impact` only when the scan has one or more vendor-provenanced `CodeMatch` records. If it cannot prove a use, it records an analysis limitation instead. A repository with no proven match is reported as having no Impact, and the report command refuses to create a confirmed Impact Report.

An `Analysis Limitation` is different from a `CodeMatch`: it identifies code that resembles the affected usage but that the local analyzer cannot prove. Computed or dynamic endpoint access, such as `slack[endpoint]` or `slack.files[method]`, is disclosed this way. A direct-looking call reached through an unsupported cross-file alias is also left unresolved. Neither case can create an Impact.

For the Slack example, the scanner recognizes a direct call shaped like:

```ts
import { WebClient } from "@slack/web-api";

const slack = new WebClient(token);
await slack.files.upload({ channels: channel, file });
```

The receiver must resolve to a `WebClient` imported from `@slack/web-api`. Comments, strings, unrelated identifiers, similarly named clients from other packages, method shape alone, shadowed bindings, reassigned bindings, and unsupported dynamic access do not become CodeMatches. Those cases are either ignored or disclosed as limitations.

## Current scan boundary

The MVP scans one repository with one root `package.json`. It analyzes JavaScript and TypeScript files (`.js`, `.jsx`, `.ts`, and `.tsx`) using local AST analysis and literal endpoint matching.

The scanner currently supports the narrow, transparent Slack path above. It does not claim to understand every JavaScript construct, runtime reachability, generated code, workspaces, multiple languages, or dynamic API usage. It prefers an incomplete result over an unsupported Impact.

Repository contents remain local during scanning. The collection and scan artifacts are explicit JSON files so each boundary can be inspected and tested independently.

## Project layout

- `src/collection/` validates the committed vendor notice fixture.
- `src/scan/` walks the repository and produces proven CodeMatches and limitations.
- `src/domain/` defines and validates the versioned notice, scan, CodeMatch, and Impact artifacts.
- `src/report/` renders the local HTML Impact Report.
- `src/cli.ts` exposes the `collect`, `scan`, and `report` commands.
- `fixtures/` contains the Slack notice and small repositories used by the acceptance tests.
- `test/` verifies behavior through the compiled CLI and filesystem artifacts.
- `docs/product-contract.md` records the product rules and MVP boundary.
- `docs/adr/0001-separate-public-collection-from-local-analysis.md` records the privacy boundary.
- `tools/oxlint/anti-slop/` contains the local anti-slop lint plugin used by this repository.

The Issue #3 proof walkthrough is available at [docs/show-me-issue-3.html](docs/show-me-issue-3.html).

## Development checks

Run the full acceptance suite, typecheck, and lint before committing changes:

```bash
npm test
npm run typecheck
npm run lint
```

The acceptance tests cover the full local workflow, including notice validation, a proven Slack match, report generation, failed collection gates, Slack-shaped decoys, scope or reassignment cases, dynamic endpoint access, cross-file aliases, and limitation-only scans that must not be promoted to Impact.
