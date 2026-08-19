# Watched vendor notices

One fixture per `WatchedVendor` (ADR 0002): a curated first-party source with a live collector
but no repository matcher. Each one runs through exactly the same collection path and the same
assertion gates as Slack, OpenAI and Cloudflare. None of them can produce an Impact, because
none of them has a matcher.

Every `excerpt` below was read off the vendor's own page on 19 August 2026 and is stored
verbatim. If a page moves, replace the excerpt from the new page rather than editing the stored
words to fit.

| File | Source | Excerpt provenance |
|---|---|---|
| `github-sbom.json` | [GitHub Changelog, 12 May 2026](https://github.blog/changelog/2026-05-12-synchronous-sbom-api-deprecated/) | The changelog's own deprecation sentence, verbatim. |
| `shopify-checkout-configurations-webhook.json` | [Shopify developer changelog](https://shopify.dev/changelog/deprecation-of-checkoutandaccountsconfigurationsupdate-webhook) | The entry's removal sentence, verbatim except that the page's code backticks around the webhook name are dropped. |
| `vercel-now-json.json` | [Vercel changelog](https://vercel.com/changelog/support-for-now-json-will-be-removed-on-march-31-2026) | The changelog sentence, verbatim including the ordinal "March 31st". |
| `firebase-ml.json` | [Firebase ML docs](https://firebase.google.com/docs/ml) | The deprecation banner sentence, verbatim. |
| `auth0-rules-and-hooks.json` | [Auth0 deprecations and migrations](https://auth0.com/docs/troubleshoot/product-lifecycle/deprecations-and-migrations) | The Rules and Hooks end-of-life sentence, verbatim. |
| `hubspot-contact-lists-v1.json` | [HubSpot developer changelog](https://developers.hubspot.com/changelog/upcoming-sunset-v1-lists-api) | The sunset sentence, verbatim except that the page's inline link markup around the API name is dropped. |
| `google-maps-heatmap-layer.json` | [Google Maps Platform deprecations](https://developers.google.com/maps/deprecations) | The Heatmap Layer entry's two-sentence description, verbatim. |

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
3. Add a fixture here with the verbatim excerpt and the vendor's own deadline wording.
4. Run `npm test`. The gates decide whether the source is admissible; do not loosen them to
   admit a page that does not qualify.
