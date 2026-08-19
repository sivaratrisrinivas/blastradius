# Recorded Bright Data heal responses

These files are `GET /dca/collectors/{id}/refactor_template/progress` payloads, replayed
by the offline acceptance suite through a fake fetcher and by `blast heal --recorded` in the
demo. ADR 0003 requires them to be recorded rather than invented.

| File | Provenance |
|---|---|
| `awaiting-approval.progress.json` | Verbatim capture of a real heal on 19 Aug 2026, at the approval gate. Only account identifiers were replaced with same-shape placeholders (emails, customer id, collector id, template/parser/job ids). Every key, both `parse_code` bodies and the `preview_result` are untouched. |
| `resumed-done.progress.json` | The terminal payload after `resume_automation_job`. `completed_steps` is verbatim from the same recorded run — the reject envelope printed those seven steps. `status: "done"` is the raw progress status that the Bright Data CLI maps to `rejected` on reject and to a finished heal on approve. |
| `in-progress.progress.json` | A payload that has not reached the gate. `completed_steps` is a prefix of the recorded sequence. The status string a running heal reports was **not** captured, so `"running"` here is a stand-in: the adapter treats every status that is not `pending_answer`, `done`, `failed`, `error`, or `cancelled` as still running, and therefore does not depend on this value. |

Regenerating `awaiting-approval.progress.json` costs a real ~3 minute heal and Bright Data
credits. Do not re-capture it to make a test pass.
