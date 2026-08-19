# Blast Radius

Blast Radius connects authoritative vendor shutdown notices to repository locations it can prove use the affected capability. It prefers incomplete certainty over unsupported coverage.

## Language

**VendorNotice**:
A first-party public document containing an explicit deprecation, sunset, shutdown, or removal statement, retained with its source URL, retrieval time, and smallest supporting excerpt.
_Avoid_: News item, discovery source

**CapabilityChange**:
An AI-interpreted lifecycle change constrained by assertion gates: an authoritative vendor source, explicit lifecycle language, a named capability identifier, and only a verbatim, unambiguous deadline when present. The gates constrain what AI may assert; they do not pretend to prove the meaning of prose.
_Avoid_: Breaking change, AI finding

**CodeMatch**:
A file and line that deterministic local analysis connects to the changed capability with vendor provenance. Its evidence strength is `direct` or `alias-traced`, and its context is `source`, `test`, or `example`; unresolved dynamic usage is never a CodeMatch.
_Avoid_: Possible usage, dependency presence

**Impact**:
A CapabilityChange with one or more CodeMatches. Blast Radius may miss usage it cannot prove, but it must never present unproved usage as an Impact.
_Avoid_: Potential impact, severity

**CollectorHealth**:
The limited health state inferred from zero results, required-field collapse, or schema failure. These signals can detect some collector drift but cannot prove that semantically correct content was extracted.
_Avoid_: Guaranteed scraper correctness

**CollectorHeal**:
A Bright Data self-healing cycle for one drifted collector: detect, compose a prompt from the detected signal, heal, await approval, approve or reject, rerun. The collector identity is unchanged; only its template moves.
_Avoid_: Repair, recovery, auto-fix
