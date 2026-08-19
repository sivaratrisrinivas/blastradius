# CollectorHeal calls Bright Data for real; tests stay offline

CollectorHeal drives Bright Data's real self-healing flow: compose a heal prompt from the detected CollectorHealth signal, `POST /dca/collectors/{id}/refactor_template`, poll to the approval gate, then approve or reject. The previous local `validate` stage is deleted, because Bright Data's own `request_fulfillment_validator` step now does that job and two things wearing one word is worse than one.

The automated suite replays recorded heal envelopes through a fake fetcher instead of reaching the network, so `npm test` stays fast and offline, while one narrow live contract test proves the integration is genuine. The recorded envelopes are captured from real API responses, never invented.

## Consequences

A real heal takes roughly two to three minutes end to end, which is longer than a demo can wait — so the demonstration shows live collection and a live approval gate, with the heal itself pre-recorded.
