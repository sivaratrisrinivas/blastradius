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

An Impact needs two receipts: the vendor notice proves what changed, and the local scan proves where the capability is used. If either is missing, Blast Radius keeps the result out of the Impact list — an incomplete answer over a confident-looking one that can't be checked.

## The words the product uses

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

Full definitions live in [CONTEXT.md](CONTEXT.md).

## How the workflow works

```text
blast collect  ->  VendorNotice + CapabilityChange
blast scan     ->  CodeMatches + Analysis Limitations
blast report   ->  local HTML Impact Report
```

`collect` turns one official vendor page into a stored, gated JSON artifact. `scan` reads that notice and inspects one local repository with AST analysis, config parsing, and literal endpoint matching, producing exact `file:line` matches plus separately recorded Analysis Limitations for anything it can't prove. `report` renders the result as a local HTML file; with no proven CodeMatch, there is no Impact and no confirmed report.

A fourth command, `blast heal`, only appears when `collect` detects a drifted collector — see [Optional collector healing](#optional-collector-healing).

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

Open `/tmp/blast-radius-demo/impact-report.html` in a browser. The Slack demo proves one direct match at `src/slack-upload.ts:6`.

Two more end-to-end examples ship with the repo: swap `fixtures/openai-notice.json` + `fixtures/repository-openai`, or `fixtures/cloudflare-kv-notice.json` + `fixtures/repository-cloudflare`, into the same three commands.

## Example output

[`examples/`](examples/) commits the structured output of every stage — a real Bright Data collector row, the `vendor-notice`, `scan-result`, and Impact Report artifacts, and the composed heal prompt with the real `parse_code` diff Bright Data proposed — so it can be inspected without running the CLI. [`examples/README.md`](examples/README.md) traces each file back to the command or the live capture that produced it.

## Vendor coverage

Blast Radius watches 10 curated first-party vendor sources. It can prove code usage for 3 of them — both numbers are always shown together, and the bigger one never stands in for the smaller.

| Matched vendor | Capability | Deadline | Source |
| --- | --- | --- | --- |
| Slack | `files.upload` | November 12, 2025 | [changelog](https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/) |
| OpenAI | Assistants API | August 26, 2026 | [migration guide](https://developers.openai.com/api/docs/assistants/migration) |
| Cloudflare | Legacy Workers KV namespace routes | October 15, 2026 | [changelog](https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/) |

The other 7 are `WatchedVendor`s: collected and health-checked exactly like the three above, but with no repository matcher, so a scan of one always reports no Impact and says why. `test/issue-13.acceptance.test.ts` proves that stays true.

| Watched vendor | Capability | Deadline in the vendor's own words |
| --- | --- | --- |
| GitHub | Synchronous SBOM REST API | November 13, 2026 |
| Shopify | `checkout_and_accounts_configurations/update` webhook | January 1, 2026 |
| Vercel | `now.json` config file | March 31st, 2026 |
| Firebase | Firebase ML | June 15, 2027 |
| Auth0 | Rules and Hooks | November 18th, 2026 |
| HubSpot | V1 Contact Lists API | April 30, 2026 |
| Google Maps Platform | Heatmap Layer | unavailable as of May 2026 |

Three of those deadlines (Vercel, Auth0, Google Maps) are written as an ordinal day or a bare month, so none is normalized to an ISO date — inventing one would be a claim the source doesn't support.

A collector is a generated command pointed at one curated URL; a matcher is hand-written analysis that traces imports, aliases, and assignments and attaches vendor provenance to every hit. Collectors are cheap to add, matchers are not (roughly 650 lines currently cover three vendors), so the fleet of collectors grew and the matcher set did not — the report publishes that gap instead of hiding it. Every vendor has its own live Bright Data collector; `fixtures/watched/README.md` names the one behind each fixture.

## Eval table

This table is not typed by hand. `npm run metrics` re-runs the real scanner, assertion gates, deadline normaliser, and heal workflow over the fixtures the acceptance suite already proves, then writes the result here, so the numbers cannot drift from the code they describe.

<!-- eval-table:start -->

**Headline: 0 false Impacts across 6 adversarial fixtures.**

| Metric | Result | Source |
| --- | --- | --- |
| Call-site match precision | 100% (14/14) | positive matcher fixtures, proven in the Slack, OpenAI, and Cloudflare acceptance tests |
| False Impacts on the adversarial decoy | 0 across 6 adversarial fixtures | `client.files.upload()` and other vendor-shaped calls with no vendor provenance, proven in the same acceptance tests |
| Limitation-disclosure rate | 100% (9/9) | dynamic-access fixtures, proven in the same acceptance tests |
| Assertion-gate rejection counts | provenance: 1, lifecycle-language: 2, capability-identity: 1, change-type: 1, evidence: 1, deadline: 2 | gate fixtures, one per gate — `test/issue-14.acceptance.test.ts`, mirroring `test/issue-5.rules.test.ts` |
| Date-normalisation accuracy | 100% (6/6) | exact / partial / relative / ranged deadline fixtures — `test/issue-5.rules.test.ts` |
| Heal success rate | 50% (1/2) | healthy and failed rerun fixtures — `test/issue-12.acceptance.test.ts` |

<!-- eval-table:end -->

Run `npm run metrics` after changing a matcher, a gate, or a fixture to keep this table current. `test/issue-14.acceptance.test.ts` fails if the table in this file falls out of sync with what the suite currently proves.

## Why the product trusts what it publishes

Collection applies five deterministic assertion gates to every extracted notice: the source must come from the curated first-party allowlist, contain a verbatim excerpt with explicit lifecycle language naming the capability, use a supported change type (deprecation, sunset, shutdown, removal), and preserve the original deadline wording — `deadline_iso` is populated only for one complete, unambiguous date. A candidate that fails a gate can stay around for diagnostic review; it can never become an accepted `CapabilityChange` or an Impact.

Scanning follows the same discipline in code. It resolves the receiver or literal to the expected vendor client — a `WebClient` imported from `@slack/web-api` for Slack, a `beta.assistants.create` call on an `openai`-imported client for OpenAI, exact legacy KV route literals for Cloudflare — and traces same-file imports, aliases, destructuring, and assignment chains, recording the exact file, line, and source text. Comments, strings, unrelated identifiers, shadowed or reassigned bindings, and unsupported dynamic access never become matches; they surface as an `Analysis Limitation` instead, e.g. `slack[method](payload)`, where the scanner sees something related but can't prove which capability runs.

Every Impact carries a deadline state of `upcoming`, `past`, or `date-not-stated`, using an injected clock so tests don't depend on today's date; the original vendor wording is always kept alongside it.

Collector health is checked against three narrow signals — zero results, required-field collapse, schema failure — and a pass means only that those three checks succeeded, not that the extracted content is semantically correct.

Full rules: [docs/product-contract.md](docs/product-contract.md).

## Optional live Bright Data collection

The default demo uses local fixtures and needs no credentials. An opt-in live path proves a real Scraper Studio collector produces the same shape of data.

```dotenv
BRIGHTDATA_API_KEY=your-api-token
BRIGHTDATA_COLLECTOR_ID=c_your-published-collector
```

```bash
npm run build
node dist/src/cli.js collect --live --vendor Slack --output /tmp/blast-radius-demo/live-vendor-notice.json
```

`--vendor` accepts any of the 10 curated vendors. Each has its own collector — one collector holds one parse template, written for one page's structure, so pointing one at another vendor's page returns nothing usable. The adapter sends Bright Data only the selected public vendor URL; it never sends repository contents.

Run `npm run test:brightdata` for the live contract checks (skipped without credentials). Per-vendor variables and the collector-creation recipe: [docs/brightdata-collection.md](docs/brightdata-collection.md).

## Optional collector healing

When `collect` detects collector drift, `blast heal` drives Bright Data's own self-healing endpoint through a human-approval gate — the vendor's AI rewrites the template, not a local guess:

```text
detect -> compose prompt -> heal -> await approval -> approve or reject -> healthy rerun
```

The collector keeps running its current template until a person explicitly approves the proposal; `--auto-approve` and `--auto-save` are refused everywhere in the CLI. A rejected proposal leaves the collector exactly as it was. An approved one reruns and either reports healthy or, if the collector drifts again, fails honestly rather than claiming success.

```bash
node dist/src/cli.js heal detect --diagnostic <collector-health.json> --last-known-good <last-good-notice.json> --output heal-detected.json
node dist/src/cli.js heal run --heal heal-detected.json --output heal-gated.json
node dist/src/cli.js heal approve --heal heal-gated.json --output heal-approved.json
node dist/src/cli.js heal rerun --heal heal-approved.json --fixture fixtures/collector-health/healed-rerun.json --output heal-rerun.json
```

`heal run` takes two to three minutes and spends credits live, or replays a recorded response with `--recorded fixtures/heal/awaiting-approval.progress.json` — the resulting artifact is marked `heal.source: "recorded"` so replayed evidence is never shown as a live call. Pass the healed artifact to `report --heal <heal-rerun.json>` to see the line-level template diff at the approval gate. Healing moves a collector's template, never its identity.

## The local report

The generated HTML report walks a clear three-action path — verify the notice, scan the repository, open the Impact Report — keeping the CapabilityChange, deadline status, proven CodeMatches, and Analysis Limitations in separate sections. It is local HTML with no data leaving the machine, and supports keyboard navigation, a skip link, and reduced-motion preferences. Walkthrough: [docs/show-me-issue-3.html](docs/show-me-issue-3.html).

## Privacy boundary

Repository analysis stays local by design: the collection boundary may receive public vendor material, but never the repository being scanned.

```text
public vendor material -> collection artifact
local repository       -> scan artifact -> local report
```

See [ADR-0001](docs/adr/0001-separate-public-collection-from-local-analysis.md).

## Scope

Blast Radius supports one Node.js or TypeScript repository with one root `package.json`, JS/TS AST analysis, structured config parsing, and same-file import/alias/assignment tracing. It does not attempt workspace support, runtime-reachability analysis, severity scoring, CI policy, generated migration guidance, or multi-language analysis. The scanner can miss code; it must never present unproved code as an Impact.

Full boundary: [docs/product-contract.md](docs/product-contract.md).

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
| `examples/` | Committed structured output from every stage — see [Example output](#example-output). |
| `test/` | Acceptance, browser, and focused rule tests. |
| `docs/product-contract.md` | Product rules and MVP boundary. |
| `docs/adr/` | The decisions behind the design, and why each one was made. |
| `docs/ai-assistance.md` | Disclosure of how AI was used to build this. |
| `CONTEXT.md` | Domain vocabulary and definitions. |
| `tools/oxlint/anti-slop/` | Local anti-slop Oxlint plugin. |

## AI assistance

This project was built with Claude Code as a pair-programming tool throughout — implementation, tests, and documentation, issue by issue, under my direction and review. Full disclosure: [docs/ai-assistance.md](docs/ai-assistance.md).

## Development checks

```bash
npm run build       # build the project
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint
npm test            # full acceptance suite (build first)
npm run metrics     # regenerate the Eval table from the fixture suite
```

Install Chromium once before browser tests, then run them:

```bash
npx playwright install chromium
npm run test:browser
```

`npm test` covers notice validation, assertion gates, deadline handling, collector health, human-approved healing, vendor matches, aliases, decoys, dynamic access, and accessibility — all against recorded fixtures, so it needs no credentials and no network.

Two narrow live contract checks are opt-in: the collection one needs Bright Data credentials, and the healing one starts a real job and spends credits, so it also needs a deliberate `BLASTRADIUS_LIVE_HEAL=1` — it always ends in a rejection so the collector is left exactly as it was found.

```bash
npm run test:brightdata                            # collection contract only
BLASTRADIUS_LIVE_HEAL=1 npm run test:brightdata    # also runs the live heal
```

For the product rules and current scope, read [CONTEXT.md](CONTEXT.md) and [docs/product-contract.md](docs/product-contract.md).
