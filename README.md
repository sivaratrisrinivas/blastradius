# Blast Radius

Blast Radius is a local command-line tool for finding code that uses a vendor capability scheduled for deprecation, shutdown, sunset, or removal.

It connects two things:

1. An official vendor notice.
2. A code location the scanner can prove uses that capability.

The result is useful because it shows evidence instead of asking you to trust a guess.

## The idea in one example

Imagine Slack publishes this notice:

> The `files.upload` method stopped functioning on November 12, 2025.

Now imagine a repository contains this code:

```ts
import { WebClient } from "@slack/web-api";

const slack = new WebClient(token);
await slack.files.upload({ channels: channel, file });
```

Blast Radius can connect the notice to that exact call. It reports the file, line, vendor, capability, and supporting source line.

That is an `Impact`.

If the code instead says `slack[method](payload)`, the scanner cannot prove which method runs. It reports an `Analysis Limitation`, not an Impact.

This distinction is the whole product in miniature.

## The rule that controls everything

> Blast Radius may miss something it cannot prove; it must never present something it cannot prove as an Impact.

Think of an Impact as a claim that needs two receipts:

- The vendor notice proves what changed.
- The local scan proves where the capability is used.

If either receipt is missing, Blast Radius keeps the result out of the Impact list.

The product therefore prefers an incomplete answer over a confident-looking answer that cannot be checked.

## The words the product uses

Blast Radius keeps a small vocabulary so that its output stays precise. Every one of these words means one thing, in the code and in the report:

| Term | Plain-English meaning |
| --- | --- |
| `VendorNotice` | An official public page with a lifecycle statement and a supporting excerpt. |
| `CapabilityChange` | The named vendor capability and lifecycle change extracted from that notice. |
| `CodeMatch` | A repository file and line that local analysis connects to the capability. |
| `Impact` | A `CapabilityChange` with at least one proven `CodeMatch`. |
| `Analysis Limitation` | Related-looking code that the scanner cannot prove. |
| `WatchedVendor` | A curated vendor source that is collected and health-checked but has no repository matcher, so it can never produce an Impact. |
| `CollectorHealth` | A limited record of whether collection returned usable-shaped data. |
| `CollectorHeal` | One attempt to fix a drifted collector, from detection through a human decision to a rerun. |

`CodeMatch` records carry evidence strength: `direct` or `alias-traced`.

They also carry context: `source`, `test`, or `example`.

## How the workflow works

The normal workflow has three commands:

```text
blast collect  ->  VendorNotice + CapabilityChange
blast scan     ->  CodeMatches + Analysis Limitations
blast report   ->  local HTML Impact Report
```

There is a fourth command, `blast heal`, but it is not part of the normal path. It only appears when collection detects that a collector has drifted, and it is described under [Optional collector healing](#optional-collector-healing).

### 1. `collect` checks the notice

Collection turns public vendor material into a stored JSON artifact.

The artifact keeps the source URL, retrieval time, smallest useful excerpt, capability identifier, change type, and original deadline wording.

The included demo uses saved fixtures. That makes the workflow deterministic and keeps the repository offline.

An optional live path can use a published Bright Data Scraper Studio collector. It is opt-in and receives only the selected public vendor URL.

### 2. `scan` checks the repository locally

The scanner reads the stored notice and inspects one local JavaScript or TypeScript repository.

It uses AST analysis, structured configuration parsing, and literal endpoint matching.

It writes exact relative file paths and line numbers for proven matches.

It writes unresolved related code separately, with a plain-English reason.

### 3. `report` explains the result

The report is generated locally as an HTML file.

It shows the notice, capability change, deadline status, proven CodeMatches, and Analysis Limitations in separate sections.

If there is no proven CodeMatch, the scan has no Impact and `report` does not create a confirmed Impact report.

## Quick start

You need Node.js and npm.

Install dependencies and build the CLI:

```bash
npm install
npm run build
```

Collect the included Slack notice:

```bash
mkdir -p /tmp/blast-radius-demo

node dist/src/cli.js collect \
  --fixture fixtures/slack-notice.json \
  --output /tmp/blast-radius-demo/vendor-notice.json
```

Scan the included example repository:

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

Open `/tmp/blast-radius-demo/impact-report.html` in a browser.

The Slack demo proves one direct match at `src/slack-upload.ts:6`.

## Ten vendors watched, three capabilities provable

Blast Radius watches 10 curated first-party sources. It can prove code for 3 of them.

Both numbers are always shown together. The bigger one is never allowed to stand in for the smaller one.

The 7 sources without a matcher are `WatchedVendor`s.

A `WatchedVendor` is collected and checked exactly like the other three. Its notice goes through the same gates. Its collector reports the same health signals and can be healed the same way.

What it cannot do is produce an Impact. There is no matcher for it, so a scan finds nothing and says so.

That is the designed answer, not a missing feature. `test/issue-13.acceptance.test.ts` proves it stays that way.

| Watched vendor | Capability | Deadline in the vendor's own words |
| --- | --- | --- |
| GitHub | Synchronous SBOM REST API | November 13, 2026 |
| Shopify | `checkout_and_accounts_configurations/update` webhook | January 1, 2026 |
| Vercel | `now.json` config file | March 31st, 2026 |
| Firebase | Firebase ML | June 15, 2027 |
| Auth0 | Rules and Hooks | November 18th, 2026 |
| HubSpot | V1 Contact Lists API | April 30, 2026 |
| Google Maps Platform | Heatmap Layer | unavailable as of May 2026 |

Three of those deadlines are never turned into a normalized date.

Vercel and Auth0 write the day as an ordinal, "31st" and "18th". Google Maps gives a month with no day. There is no unambiguous full date to record, so none is recorded. Filling one in would be an invented claim.

### Why the collectors grew and the matchers did not

A collector is one generated command pointed at a curated URL. Adding one is cheap.

A matcher is hand-written analysis. It has to trace imports, aliases, and assignments, and attach vendor provenance to every hit. Roughly 650 lines currently cover three vendors.

Twenty thin matchers would be quick to write and would manufacture exactly the unproved coverage the rule at the top of this file forbids.

So the fleet grew and the matcher set did not, and the report publishes the gap instead of hiding it.

### Seeing it work

```bash
node dist/src/cli.js collect \
  --fixture fixtures/watched/firebase-ml.json \
  --output /tmp/blast-radius-demo/firebase-notice.json
node dist/src/cli.js scan fixtures/repository \
  --collection /tmp/blast-radius-demo/firebase-notice.json \
  --output /tmp/blast-radius-demo/firebase-scan.json
```

The scan succeeds and reports no Impact. It names the reason: Firebase is a `WatchedVendor` with no repository matcher, so this source can never produce one.

Both numbers print from `collect` and `scan` as well as from the report. A watched vendor never produces an Impact, so it never produces a report, and the disclosure has to appear somewhere a watched-only run can see it.

Every watched vendor has its own live Bright Data collector, and the fixtures in `fixtures/watched/` are the envelopes those collectors actually returned. Nothing there was typed by hand. `fixtures/watched/README.md` names the collector behind each one.

## The three provable vendor changes

The MVP has one narrow example for each matched vendor:

| Vendor | Capability | Deadline | Fixture repository |
| --- | --- | --- | --- |
| Slack | `files.upload` | November 12, 2025 | `fixtures/repository` |
| OpenAI | Assistants API | August 26, 2026 | `fixtures/repository-openai` |
| Cloudflare | Legacy Workers KV namespace routes | October 15, 2026 | `fixtures/repository-cloudflare` |

Each notice comes from a first-party source:

- [Slack changelog](https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/)
- [OpenAI Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration)
- [Cloudflare KV routes changelog](https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/)

The other examples use the same three commands as the Slack example.

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

For Cloudflare, the scanner recognizes the old `/accounts/{account_id}/workers/namespaces/*` route.

It deliberately does not match the replacement `/storage/kv/namespaces/*` route.

## Eval table

This table is not typed by hand. `npm run metrics` re-runs the real scanner, assertion gates, deadline normaliser, and heal workflow over the fixtures the acceptance suite already proves, then writes the result here, so the numbers cannot drift from the code they describe.

<!-- eval-table:start -->

**Headline: 0 false Impacts across 6 adversarial fixtures.**

| Metric | Result | Source |
| --- | --- | --- |
| Call-site match precision | 100% (14/14) | positive matcher fixtures — `test/issue-2/3/4/6/7.acceptance.test.ts` |
| False Impacts on the adversarial decoy | 0 across 6 adversarial fixtures | `client.files.upload()` and other vendor-shaped calls with no vendor provenance — `test/issue-3/4/6/7.acceptance.test.ts` |
| Limitation-disclosure rate | 100% (9/9) | dynamic-access fixtures — `test/issue-3/4/6/7.acceptance.test.ts` |
| Assertion-gate rejection counts | provenance: 1, lifecycle-language: 2, capability-identity: 1, change-type: 1, evidence: 1, deadline: 2 | gate fixtures, by gate — `test/issue-14.acceptance.test.ts`, mirroring `test/issue-5.rules.test.ts` |
| Date-normalisation accuracy | 100% (6/6) | exact / partial / relative / ranged deadline fixtures — `test/issue-5.rules.test.ts` |
| Heal success rate | 50% (1/2) | healthy and failed rerun fixtures — `test/issue-12.acceptance.test.ts` |

<!-- eval-table:end -->

Run `npm run metrics` after changing a matcher, a gate, or a fixture to keep this table current. `test/issue-14.acceptance.test.ts` fails if the table in this file falls out of sync with what the suite currently proves.

## Why a notice is allowed to become a change

Collection applies deterministic assertion gates to the extracted result.

These gates do not prove that a machine understood every sentence. They constrain what the product is allowed to claim.

The source must:

1. Belong to the curated first-party vendor allowlist.
2. Contain a verbatim excerpt with explicit lifecycle language.
3. Name the affected capability in that excerpt.
4. Use a supported change type: deprecation, sunset, shutdown, or removal.
5. Preserve the original deadline wording.

`deadline_iso` is populated only when the notice gives one complete, unambiguous date.

The product does not invent a day from a month, a year from a relative phrase, or precision from a date range.

A candidate that fails a gate may remain available for diagnostic review. It cannot become an accepted `CapabilityChange` or an Impact.

## Why code becomes a match, or does not

The scanner does not ask whether a package name merely appears in the repository.

It follows a narrow chain of evidence:

1. Find the vendor-specific capability identifier.
2. Resolve the receiver or literal to the expected vendor source.
3. Confirm the access pattern is supported.
4. Record the exact file, line, and source text.

For Slack, a receiver must resolve to a `WebClient` imported from `@slack/web-api`.

For OpenAI, the scanner proves `beta.assistants.create` calls whose receiver resolves to an OpenAI client imported from `openai` or loaded with `require("openai")`.

For Cloudflare, it proves exact legacy Workers KV route literals in source code and supported JSON or TOML configuration values.

Same-file imports, destructuring, aliases, and assignment chains can be traced when the evidence remains transparent.

Comments, strings, unrelated identifiers, similarly named clients, shadowed bindings, reassigned bindings, and unsupported dynamic access do not become matches.

## What an Analysis Limitation means

An Analysis Limitation is not a weaker Impact.

It is a visible statement that the scanner found something related but could not establish the required proof.

Examples include:

```ts
slack[method](payload);
slack.files[method](payload);
```

The analyzer cannot know which capability those expressions select.

An unsupported cross-file alias is also kept unresolved.

The scan still succeeds and stores the file, line, and reason under `limitations`.

A repository with only limitations has no Impact.

This is how the product avoids turning uncertainty into a user-facing claim.

## Deadline behavior

Every Impact has one of three deadline states:

- `upcoming`
- `past`
- `date-not-stated`

The report always keeps the original vendor wording.

The report clock is injected, so tests and demonstrations do not depend on the machine's current date.

If the source has no exact full date, the report says that the date was not stated.

## Optional live Bright Data collection

The normal demo uses local fixtures. The live path is an optional proof that a real custom Scraper Studio collector can produce the same collection shape.

Put credentials and a published collector ID in the ignored root `.env` file:

```dotenv
BRIGHTDATA_API_KEY=your-api-token
BRIGHTDATA_COLLECTOR_ID=c_your-published-collector
```

Run the live path explicitly:

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

`--vendor` accepts any of the ten curated vendors, watched and matched alike.

All ten vendors have been collected live. Each one has its own collector, because a collector holds one parse template and a template is written against one page structure. Pointing one collector at another vendor's page returns nothing usable, which is a thing this project learned the expensive way.

The per-vendor variables are listed in [docs/brightdata-collection.md](docs/brightdata-collection.md), along with the `bdata scraper create` recipe for building a new one.

The adapter sends Bright Data only the selected curated public vendor URL.

It never sends repository source, paths, snippets, symbols, CodeMatches, or scan artifacts.

Run `npm run test:brightdata` for the narrow live contract checks. The collection check is skipped unless both environment values are configured, and the healing check needs a further opt-in described below.

See [docs/brightdata-collection.md](docs/brightdata-collection.md) for the collector output details.

## Collector health: detecting drift without pretending to prove correctness

Collectors can fail in ways that look valid.

Blast Radius therefore records only three limited health signals:

- zero results
- required-field collapse
- schema failure

If one signal appears, `collect` writes a `collector-health` diagnostic, exits non-zero, and withholds that output from scanning and reporting.

A healthy record means only that those three checks passed.

It does not prove semantic correctness, completeness, or guaranteed scraper behavior.

## Optional collector healing

Healing is a trust workflow underneath the main notice-to-code workflow. It drives Bright Data's own self-healing endpoint, so the collector's template is rewritten by the vendor's AI rather than renamed locally.

It follows this sequence:

```text
detect -> compose prompt -> heal -> await approval -> approve or reject -> healthy rerun
```

The collector keeps running its current template until a person explicitly approves the proposal. `--auto-approve` and `--auto-save` are not on the product path at all: the CLI refuses both.

Compose the heal prompt from a stored health failure. The prompt is built from the detected signal, not typed by hand — it names the field that collapsed and, given a previous healthy notice, the value that field last held:

```bash
node dist/src/cli.js heal detect \
  --diagnostic /tmp/blast-radius-demo/collector-health.json \
  --last-known-good /tmp/blast-radius-demo/vendor-notice.json \
  --output /tmp/blast-radius-demo/heal-detected.json
```

Send it to Bright Data and stop at the approval gate. This takes two to three minutes and spends credits:

```bash
node dist/src/cli.js heal run \
  --heal /tmp/blast-radius-demo/heal-detected.json \
  --output /tmp/blast-radius-demo/heal-gated.json
```

Add `--recorded fixtures/heal/awaiting-approval.progress.json` to replay a captured response instead. The artifact then records `heal.source: "recorded"`, and the report says so, so replayed evidence is never shown as a live call.

Approve or reject the proposed template. Rejecting leaves the collector exactly as it was:

```bash
node dist/src/cli.js heal approve \
  --heal /tmp/blast-radius-demo/heal-gated.json \
  --output /tmp/blast-radius-demo/heal-approved.json

node dist/src/cli.js heal reject \
  --heal /tmp/blast-radius-demo/heal-gated.json \
  --output /tmp/blast-radius-demo/heal-rejected.json
```

Run the healthy rerun:

```bash
node dist/src/cli.js heal rerun \
  --heal /tmp/blast-radius-demo/heal-approved.json \
  --fixture fixtures/collector-health/healed-rerun.json \
  --output /tmp/blast-radius-demo/heal-rerun.json
```

`--fixture` reruns against a stored notice. Swap it for `--live` to re-collect from the curated source the drift was detected on, using the same Bright Data credentials as `collect --live`:

```bash
node dist/src/cli.js heal rerun \
  --heal /tmp/blast-radius-demo/heal-approved.json \
  --live \
  --output /tmp/blast-radius-demo/heal-rerun.json
```

A live rerun needs the vendor and source URL recorded on the heal, which `heal detect` carries across from the diagnostic. Either way the rerun exits non-zero if the collector drifts again, and the artifact records the failure rather than a healthy result.

You can pass the healed artifact to `report`:

```bash
node dist/src/cli.js report \
  --scan /tmp/blast-radius-demo/scan-result.json \
  --heal /tmp/blast-radius-demo/heal-rerun.json \
  --output /tmp/blast-radius-demo/impact-report-with-healing.html
```

Without `--heal`, the report stays on the simple three-action path. With it, the approval gate shows the line-level diff between the collector's current `parse_code` and the one Bright Data proposed.

Healing moves a collector's template, never its identity. A healthy rerun says only that the supported health checks passed; it does not claim autonomous or guaranteed correctness.

## The local report

The report presents a clear three-action workflow:

1. Verify the vendor notice.
2. Scan the local repository.
3. Open the Impact Report.

It keeps authoritative evidence, the CapabilityChange, deadline status, proven CodeMatches, and Analysis Limitations separate.

It also supports keyboard navigation, a skip link, focus movement to new headings, progress announcements, and reduced-motion preferences.

The report is local HTML. No report data needs to leave the machine.

The Issue #3 proof walkthrough is available at [docs/show-me-issue-3.html](docs/show-me-issue-3.html).

## Privacy boundary

Repository analysis stays local by design.

The external collection boundary may receive public vendor material, but it does not receive the repository being scanned.

The saved JSON artifacts make both sides inspectable:

```text
public vendor material -> collection artifact
local repository       -> scan artifact -> local report
```

This separation supports offline demos and protects proprietary repository contents.

See [docs/adr/0001-separate-public-collection-from-local-analysis.md](docs/adr/0001-separate-public-collection-from-local-analysis.md).

## MVP boundary

The current product intentionally supports:

- one Node.js or TypeScript repository with one root `package.json`;
- JavaScript and TypeScript AST analysis;
- structured configuration parsing;
- minimally normalized literal endpoint matching;
- same-file imports, aliases, destructuring, and assignment chains;
- exact `file:line` results with `direct` or `alias-traced` evidence.

It does not claim:

- a repository matcher for any watched vendor;
- workspace support;
- runtime-reachability analysis;
- complete semantic understanding;
- severity scoring;
- CI policy;
- generated migration guidance;
- multi-language analysis;
- proof of dynamic or unsupported usage.

The scanner can miss code. It must not present unproved code as an Impact.

## Project layout

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
| `src/cli.ts` | Exposes `collect`, `scan`, `report`, and `heal`. |
| `src/metrics/` | Re-runs the fixture suite to compute the [Eval table](#eval-table) and write it into this README. |
| `fixtures/` | Vendor notices and small repositories used by tests. |
| `fixtures/heal/` | Real Bright Data healing responses, recorded once and replayed offline. |
| `fixtures/watched/` | First-party notices for the watched vendors, with provenance for every excerpt. |
| `test/` | Acceptance, browser, and focused rule tests. |
| `docs/product-contract.md` | Product rules and MVP boundary. |
| `docs/adr/` | The decisions behind the design, and why each one was made. |
| `CONTEXT.md` | Domain vocabulary and definitions. |
| `tools/oxlint/anti-slop/` | Local anti-slop Oxlint plugin. |

## Development checks

Build the project:

```bash
npm run build
```

Run the typecheck:

```bash
npm run typecheck
```

Run the configured Oxlint checks:

```bash
npm run lint
```

Install Chromium once before browser tests:

```bash
npx playwright install chromium
```

Run browser checks:

```bash
npm run test:browser
```

Run the full acceptance suite:

```bash
npm test
```

The tests cover notice validation, assertion gates, deadline handling, collector health, human-approved healing, vendor matches, aliases, decoys, and dynamic access.

Regenerate the [Eval table](#eval-table) from the fixture suite:

```bash
npm run metrics
```

The healing tests replay recorded Bright Data responses through a fake fetcher and never reach the network, so `npm test` works with no credentials and no connection.

Two narrow live contract checks are opt-in. The collection one needs credentials. The healing one starts a real job on the live collector and spends credits, so credentials alone are not enough — it also needs a deliberate `BLASTRADIUS_LIVE_HEAL=1`, and it always ends in a rejection so the collector is left exactly as it was found:

```bash
npm run test:brightdata                            # collection contract only
BLASTRADIUS_LIVE_HEAL=1 npm run test:brightdata    # also runs the live heal
```

They also cover cross-file aliases, limitation-only scans, reports, and accessibility behavior.

For the product rules and current scope, read [CONTEXT.md](CONTEXT.md) and [docs/product-contract.md](docs/product-contract.md).
