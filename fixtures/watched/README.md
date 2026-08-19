# Watched vendor notices

One fixture per `WatchedVendor` (ADR 0002): a curated first-party source with a live collector
but no repository matcher. Each one runs through exactly the same collection path and the same
assertion gates as Slack, OpenAI and Cloudflare. None of them can produce an Impact, because
none of them has a matcher.

Every fixture here is a **real capture**: the envelope written by that vendor's own live Bright
Data collector on 19–20 August 2026, stored unedited. The `collector` field on each one names the
collector that produced it, and `test/issue-13.acceptance.test.ts` asserts that no two watched
fixtures share a collector. Nothing here was typed by hand.

Re-capture with `blast collect --live --vendor <name>` rather than editing the stored words to fit.

| File | Source | Collector |
|---|---|---|
| `github-sbom.json` | [GitHub Changelog, 12 May 2026](https://github.blog/changelog/2026-05-12-synchronous-sbom-api-deprecated/) | `c_mt0ftsnb1ns94s7t8f` |
| `shopify-checkout-configurations-webhook.json` | [Shopify developer changelog](https://shopify.dev/changelog/deprecation-of-checkoutandaccountsconfigurationsupdate-webhook) | `c_mt0furjy2mtd59angp` |
| `vercel-now-json.json` | [Vercel changelog](https://vercel.com/changelog/support-for-now-json-will-be-removed-on-march-31-2026) | `c_mt0fwofo1ey25692r6` |
| `firebase-ml.json` | [Firebase ML docs](https://firebase.google.com/docs/ml?hl=en) | `c_mt0foc3t146u794rdf` |
| `auth0-rules-and-hooks.json` | [Auth0 deprecations and migrations](https://auth0.com/docs/troubleshoot/product-lifecycle/deprecations-and-migrations) | `c_mt0gr9332a0zzz15xu` |
| `hubspot-contact-lists-v1.json` | [HubSpot developer changelog](https://developers.hubspot.com/changelog/upcoming-sunset-v1-lists-api) | `c_mt0gc5om1xyjjujfsy` |
| `google-maps-heatmap-layer.json` | [Google Maps Platform deprecations](https://developers.google.com/maps/deprecations?hl=en) | `c_mt0geakyat2ca4wh2` |

## What the deadline fields are doing

Three of these seven store `deadlineIso: null` on purpose, and that is the interesting part.

- `vercel-now-json.json` and `auth0-rules-and-hooks.json` write the date as an ordinal
  ("March 31st, 2026", "November 18th, 2026"). The gate does not normalize an ordinal, so
  `deadlineOriginal` keeps the vendor's words and `deadlineIso` stays null.
- `google-maps-heatmap-layer.json` states a month with no day. There is no full date to
  normalize, so there is none recorded.

Filling those in would be an invented claim. `test/issue-13.acceptance.test.ts` asserts they
stay null.

## Adding another watched vendor

1. Find a first-party page that names the capability and says it is deprecated, sunset, shut
   down, or removed — in that order, in one sentence, or across two where the second starts
   "It"/"This API".
2. Add the source to `WATCHED_VENDORS` in `src/domain/capabilities.ts` with `matcher: null`, and
   declare its `evidenceProximity`. Prefer `adjacent`; reach for `same-sentence` only when the
   vendor's own sentence puts qualifying material between the capability name and the lifecycle
   verb, and expect that choice to be reviewed. Four of the seven here need it.
3. Build that source its own collector (`bdata scraper create`), add its ID to `.env`, and capture
   the fixture with `blast collect --live --vendor <name>`. One collector holds one parse
   template, so it cannot be shared with another source.
4. Run `npm test`. The gates decide whether the source is admissible; do not loosen them to
   admit a page that does not qualify.
