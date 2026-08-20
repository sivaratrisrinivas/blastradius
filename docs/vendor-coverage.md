# Vendor coverage

Blast Radius watches 10 curated first-party vendor sources and can prove code usage for 3 of them.
Both numbers are always printed together, and the bigger one never stands in for the smaller.

## Matched vendors

A matched vendor has a collector and a matcher, so a scan can produce an Impact.

| Matched vendor | Capability | Deadline | Source |
| --- | --- | --- | --- |
| Slack | `files.upload` | November 12, 2025 | [changelog](https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/) |
| OpenAI | Assistants API | August 26, 2026 | [migration guide](https://developers.openai.com/api/docs/assistants/migration) |
| Cloudflare | Legacy Workers KV namespace routes | October 15, 2026 | [changelog](https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/) |

## Watched vendors

A `WatchedVendor` is collected and health-checked exactly like the three above but has no
repository matcher, so a scan of one always reports no Impact and says why.
`test/issue-13.acceptance.test.ts` proves that stays true.

| Watched vendor | Capability | Deadline in the vendor's own words |
| --- | --- | --- |
| GitHub | Synchronous SBOM REST API | November 13, 2026 |
| Shopify | `checkout_and_accounts_configurations/update` webhook | January 1, 2026 |
| Vercel | `now.json` config file | March 31st, 2026 |
| Firebase | Firebase ML | June 15, 2027 |
| Auth0 | Rules and Hooks | November 18th, 2026 |
| HubSpot | V1 Contact Lists API | April 30, 2026 |
| Google Maps Platform | Heatmap Layer | unavailable as of May 2026 |

Three of those deadlines (Vercel, Auth0, Google Maps) are written as an ordinal day or a bare
month, so none is normalized to an ISO date. Inventing one would be a claim the source does not
support.

## Why the two numbers differ

A collector is a generated command pointed at one curated URL. A matcher is hand-written analysis
that traces imports, aliases, and assignments and attaches vendor provenance to every hit.

Collectors are cheap to add. Matchers are not: roughly 650 lines currently cover three vendors. So
the fleet of collectors grew and the matcher set did not, and the tool publishes that gap on every
run instead of hiding it. See [ADR-0002](adr/0002-watched-vendors-are-not-matched-vendors.md).

Every vendor has its own live Bright Data collector. `fixtures/watched/README.md` names the one
behind each fixture.
