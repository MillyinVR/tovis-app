# C2-2 suitability runtime and persistence

This slice adds optional, hair-only suitability translation to the existing analysis runner. Client/pro rendering is the next slice. Historical ANALYSIS/BRIEF JSON, HTTP response shapes and iOS DTOs are unchanged.

## Runtime

`AI_CONSULT_SUITABILITY_ENABLED=true` (exact, case-sensitive after trimming) enables one additional call through the existing approved Anthropic analysis transport. Default off. It uses the same model allowlist, schema conversion, token accounting and zero SDK retries. The suitability call has a 20-second timeout and starts only before 230 seconds have elapsed in this run; its latest completion is approximately 250 seconds, leaving 50 seconds of the route's 300-second allowance. The existing provider chain's 275-second worst case skips this optional call. There is no separate automatic suitability retry.

The context uses validated profile/core observations, only this run's optional face/color companion, and the exact LIKE/GOAL/DISLIKE client details from the pinned INSPIRATION revision. No desired choice means no call; no preference is inferred from intake or a reference image. Unknown observations remain unavailable evidence. Unsupported source shapes, invalid output and provider failures omit the sibling while preserving the existing plan. Model errors are logged as bounded kinds without client text. Provider refusals, invalid output and transport failures are metered; sanitizer validation runs inside that meter.

The server allocates the analysis ID before the call and assigns all citation/revision provenance itself. The finalize transaction rechecks consent, open window, input hash and plan ordering under the session lock before writing the analysis and optional sibling together. A new revision never borrows an older sibling. Persistence invariant failures roll back the transaction rather than saving incorrectly linked guidance.

## Storage and rollout

Apply `20261026000000_consult_suitability_translation` before this server code. The new enum and table are additive. The privacy export now queries the new relation even with generation disabled, so the flag is not a substitute for migration ordering. No data backfill is required.

`ConsultSuitabilityTranslation` has a unique analysis revision, a same-session preceding client revision, version metadata and immutable JSON. Its trigger refuses updates, mismatched revisions and missing/empty/wrong-revision citations. RLS has no client policies; only the established server database boundary may access it. Session/revision deletion cascades to this sibling. Client-owned privacy exports include the new records; storage/photo credentials and retry hashes are not added to the export.

To stop generation, unset the flag or set it to `false`. Existing rows remain immutable. Code rollback leaves the additive migration installed; do not try to remove the enum or drop records. No merge, deployment or flag activation is part of this task.

## Verification

Required local checks: focused runtime/contract/engine/privacy tests, PostgreSQL lifecycle tests, fresh migration replay, two live synthetic suitability cases through the actual runtime transport, typecheck, lint, static guards and current merged iOS fixture validation. The database tests cover failed calls, changed inputs during a call, overlapping workers after lease expiry, immutable/cross-session/citation guards, reruns with the flag disabled, and historical payloads.

The dispatcher reviewed only the new runtime and migration. Its empty-citation finding was reproduced and guarded. Other concerns required context absent from that bounded review: the 300-second route limit, server-assigned provenance, monotonic session revision sequence, locked finalize, and intentional server-only RLS are verified in their canonical implementations.

This slice does not verify stylist quality, physical-device rendering, deployment or demo readiness. Those require the subsequent matching web/iOS rendering and coordinated test checkpoint.
