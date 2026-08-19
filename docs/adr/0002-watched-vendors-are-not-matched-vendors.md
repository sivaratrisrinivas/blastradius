# Watched vendors are not matched vendors

Blast Radius watches more vendors than it can prove code for. A `WatchedVendor` has a live collector and a curated first-party source but no repository matcher, so it contributes CollectorHealth and CollectorHeal evidence and can never become an Impact. This trades the appearance of broad coverage for a gap we publish rather than hide.

## Considered Options

A bespoke AST matcher per vendor, so that every watched vendor could also produce Impacts. Rejected: matchers do not scale the way collectors do — a collector is one generated command, a matcher is hand-written provenance and alias-tracing logic, and ~650 lines currently cover three vendors. Shipping twenty thin matchers would also manufacture exactly the unproved coverage the product invariant forbids.

## Consequences

The report must state both numbers — vendors watched and capabilities provable — and must never let the larger number stand in for the smaller one.
