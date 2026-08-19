# MVP Product Contract

## Invariant

> **Blast Radius may miss something it cannot prove; it must never present something it cannot prove as an Impact.**

The product reports only repository locations that deterministic local analysis can connect to the affected vendor capability. It does not claim complete semantic understanding of a repository.

## Hero path

```text
blast collect
  -> three official vendor pages
  -> AI extracts meaning
  -> assertion gates constrain what may be claimed
  -> CapabilityChanges

blast scan ./demo-repo
  -> local AST, config, and literal endpoint matching
  -> proven CodeMatches only
  -> CLI summary and local HTML report
```

Repository contents stay local. External AI receives public vendor material only; see [ADR-0001](adr/0001-separate-public-collection-from-local-analysis.md).

## MVP vendors

- **Slack:** [`files.upload` stopped functioning on November 12, 2025](https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/).
- **OpenAI:** [the Assistants API shuts down on August 26, 2026](https://developers.openai.com/api/docs/assistants/migration).
- **Cloudflare:** [legacy Workers KV namespace routes stop working on October 15, 2026](https://developers.cloudflare.com/changelog/post/2026-07-15-kv-legacy-namespace-routes-deprecation/).

Each example has a first-party source, a fixed date, and an identifier that can be matched in Node.js or TypeScript code.

## Assertion gates

AI performs the semantic interpretation of vendor prose. Deterministic checks do not prove that interpretation; they restrict what the product is allowed to assert:

1. The source URL belongs to the curated first-party vendor allowlist.
2. A minimal verbatim excerpt contains an explicit lifecycle statement and identifies the affected capability.
3. The change type is limited to deprecation, sunset, shutdown, or removal.
4. The original deadline wording is retained; `deadline_iso` is populated only for an explicit, unambiguous full date.
5. An Impact is created only when local matching independently produces at least one vendor-provenanced CodeMatch.

Candidates that fail a gate may be retained for review, but never appear as Impacts.

## Local scan boundary

- One Node.js or TypeScript repository with one root `package.json`.
- JavaScript/TypeScript AST analysis, structured configuration parsing, and minimally normalized literal endpoint matching.
- Import/require aliases, destructuring, and assignment chains are traced only within one file.
- Locations are annotated `source`, `test`, or `example` using simple transparent path rules.
- Dynamic or unsupported constructs are disclosed as unresolved; they are not guessed.
- Results are a flat list of exact `file:line` locations with `direct` or `alias-traced` evidence strength.

No workspace support, runtime-reachability claims, severity scoring, CI policy, generated migration guidance, or multi-language analysis belongs in the MVP.

## Deadline contract

An Impact is `upcoming`, `past`, or `date-not-stated`. The original wording is always retained. The MVP supports `deadline_iso` only when a source gives an exact full date; it does not invent day, month, year, or range precision.

## Collector drift and healing

The integrity layer detects only zero results, required-field collapse, and schema failure. It does not claim to catch every wrong-but-well-shaped extraction.

When detected drift occurs, the demo follows:

```text
detect -> compose prompt -> heal -> await approval -> approve or reject -> rerun
```

The heal itself is Bright Data's: Blast Radius composes a prompt from the detected signal, calls the vendor's self-healing endpoint, and stops at its approval gate. Bright Data's own `request_fulfillment_validator` step replaces the local validation stage that this contract previously described.

The main product is notice-to-code impact analysis. CollectorHeal is the trust layer underneath it.

## Prototype pass condition

The prototype passes only when:

1. One real custom Scraper Studio collector takes an official VendorNotice through extraction, assertion gates, one exact local CodeMatch, and a local report.
2. One controlled collector failure completes the CollectorHeal workflow through human approval and a healthy rerun.

The main demonstration uses a small, believable fixture repository and deterministic stored collection data after a brief real Scraper Studio run.
