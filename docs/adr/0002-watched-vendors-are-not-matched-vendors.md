# Watched vendors are not matched vendors

Blast Radius watches more vendors than it can prove code for. A `WatchedVendor` has a live collector and a curated first-party source but no repository matcher, so it contributes CollectorHealth and CollectorHeal evidence and can never become an Impact. This trades the appearance of broad coverage for a gap we publish rather than hide.

## Considered Options

A bespoke AST matcher per vendor, so that every watched vendor could also produce Impacts. Rejected: matchers do not scale the way collectors do — a collector is one generated command, a matcher is hand-written provenance and alias-tracing logic, and ~650 lines currently cover three vendors. Shipping twenty thin matchers would also manufacture exactly the unproved coverage the product invariant forbids.

## Consequences

The report must state both numbers — vendors watched and capabilities provable — and must never let the larger number stand in for the smaller one. "Vendors watched" counts every curated first-party source, matched and unmatched; a `WatchedVendor` is specifically one of the unmatched ones.

Growing the fleet exposed a second cost. Real vendor prose puts qualifying material between the capability name and the lifecycle verb — "the `checkout_and_accounts_configurations/update` webhook, originally introduced in API version 2025-04 …, will be removed". The lifecycle gate previously handled that by special-casing one matcher name; each source now declares an `evidenceProximity` of `adjacent` or `same-sentence` instead. The gate still requires both the named capability and explicit lifecycle language, in that order, in one sentence — but which variant applies is a curation-time decision, recorded in `src/domain/capabilities.ts` and reviewed with the source. Four of the seven watched sources need `same-sentence`. That is a real loosening relative to `adjacent`, and it is declared per source rather than hidden, so a reviewer can see which sources depend on it.

A `WatchedVendor` produces no Impact, so it produces no Impact Report. Both numbers therefore appear in `collect` and `scan` output as well as in the report, or a watched-only run would never show them.
