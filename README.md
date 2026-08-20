# Blast Radius

Blast Radius finds code in your repository that calls a vendor capability the vendor has already
scheduled for deprecation, shutdown, sunset, or removal.

It connects an official vendor notice to a code location the scanner can prove uses that
capability, and shows both. No guessing, no severity score, no trust required.

## The idea in one example

Slack published this:

> The `files.upload` method stopped functioning on November 12, 2025.

A repository contains this:

```ts
import { WebClient } from "@slack/web-api";

const slack = new WebClient(token);
await slack.files.upload({ channels: channel, file });
```

Blast Radius connects the notice to that exact call and reports the file, line, vendor, capability,
and the vendor's supporting sentence. That is an `Impact`.

If the code says `slack[method](payload)` instead, the scanner cannot prove which method runs. It
reports an `Analysis Limitation`, not an Impact. That distinction is the whole product in
miniature.

## The rule that controls everything

> Blast Radius may miss something it cannot prove; it must never present something it cannot prove
> as an Impact.

An Impact needs two receipts: the vendor notice proves what changed, the local scan proves where
the capability is used. If either is missing, the result stays out of the Impact list. An
incomplete answer beats a confident-looking one nobody can check.

## Quick start

You need Node.js and npm.

```bash
npm install
npm run build
npm link            # installs the `blast` binary
```

Point it at a repository:

```bash
blast check fixtures/repository-multi-vendor
```

That prints three Impacts, one each for Slack, OpenAI, and Cloudflare, with the vendor's own words,
the deadline, the days remaining while the date is still ahead, and the exact lines that prove the
code uses it. It exits 0 whether or not it finds something, because an Impact is a finding, not a
failure.

`check` is the primary entry point: the codebase is the question, and you do not have to know which
vendor notice to pick first. It runs `collect`, `scan`, and `report` rather than replacing them, so
anything it reports can be reproduced one stage at a time.

Full command reference, including `--report-dir`, `--output`, live collection, and healing:
[docs/cli.md](docs/cli.md).

## Vendor coverage

10 curated first-party vendor sources are watched. 3 of them can be proven in code.

| Matched vendor | Capability | Deadline | Source |
| --- | --- | --- | --- |
| Slack | `files.upload` | November 12, 2025 | [changelog](https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/) |
| OpenAI | Assistants API | August 26, 2026 | [migration guide](https://developers.openai.com/api/docs/assistants/migration) |
| Cloudflare | Legacy Workers KV namespace routes | October 15, 2026 | [changelog](https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/) |

The other 7 are watched and health-checked but have no repository matcher, so they can never
produce an Impact. Collectors are cheap to add and matchers are not, and every run prints both
numbers rather than hiding the gap. The watched table and the reasoning:
[docs/vendor-coverage.md](docs/vendor-coverage.md).

## Eval table

Not typed by hand. `npm run metrics` re-runs the real scanner, assertion gates, deadline
normaliser, and heal workflow over the fixtures the acceptance suite already proves, then writes
the result here. `test/issue-14.acceptance.test.ts` fails if this table drifts from what the suite
proves.

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

## Why the output can be trusted

Collection applies five deterministic assertion gates to every extracted notice: first-party
allowlisted source, verbatim excerpt, explicit lifecycle language naming the capability, a
supported change type, and the original deadline wording preserved. `deadline_iso` is populated
only for one complete, unambiguous date. A candidate that fails a gate can stay for diagnostic
review but can never become an Impact.

Scanning follows the same discipline. It resolves the receiver or literal to the expected vendor
client, traces same-file imports, aliases, destructuring, and assignment chains, and records the
exact file, line, and source text. Comments, strings, unrelated identifiers, shadowed or reassigned
bindings, and unsupported dynamic access never become matches. They surface as Analysis
Limitations.

Collector health is checked against three narrow signals, and a pass means only that those three
checks succeeded, not that the extracted content is semantically correct.

Full rules: [docs/product-contract.md](docs/product-contract.md).

## Privacy boundary

```text
public vendor material -> collection artifact
local repository       -> scan artifact -> local report
```

The collection boundary may receive public vendor material. It never receives the repository being
scanned. See [ADR-0001](docs/adr/0001-separate-public-collection-from-local-analysis.md).

## Scope

One Node.js or TypeScript repository with one root `package.json`. JS/TS AST analysis, structured
config parsing, and same-file import, alias, and assignment tracing.

Not attempted: workspace support, runtime-reachability analysis, severity scoring, CI policy,
generated migration guidance, multi-language analysis.

## Development

```bash
npm run build       # build the project
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint
npm test            # full acceptance suite, no credentials and no network
npm run metrics     # regenerate the eval table from the fixture suite
```

Browser tests need Chromium once: `npx playwright install chromium`, then `npm run test:browser`.

Two live contract checks are opt-in. `npm run test:brightdata` needs credentials, and adding
`BLASTRADIUS_LIVE_HEAL=1` starts a real heal job that spends credits. That one always ends in a
rejection, so the collector is left exactly as it was found.

## More

| Document | What is in it |
| --- | --- |
| [CONTEXT.md](CONTEXT.md) | Domain vocabulary and definitions. |
| [docs/cli.md](docs/cli.md) | Full command reference. |
| [docs/vendor-coverage.md](docs/vendor-coverage.md) | Matched and watched vendors. |
| [docs/product-contract.md](docs/product-contract.md) | Product rules and MVP boundary. |
| [docs/brightdata-collection.md](docs/brightdata-collection.md) | Collector setup and per-vendor variables. |
| [docs/demo-runbook.md](docs/demo-runbook.md) | How the demo video is recorded. |
| [docs/project-layout.md](docs/project-layout.md) | What lives where. |
| [docs/adr/](docs/adr/) | The decisions behind the design. |
| [examples/](examples/) | Committed structured output from every stage. |
| [docs/ai-assistance.md](docs/ai-assistance.md) | How AI was used to build this. |

This project was built with Claude Code as a pair-programming tool throughout, issue by issue,
under my direction and review.
