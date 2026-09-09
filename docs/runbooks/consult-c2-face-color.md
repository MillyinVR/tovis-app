# C2-1 Face & Color pipeline

## Scope and audit

The September 9 consultation handoff explicitly names the next C2-1 slice as wiring the companion into revision-safe analysis and Brief storage. Contract PR #1138 is merged at `452c185d`. This slice resumes the audited uncommitted `codex/c2-face-color-pipeline` work from an isolated branch based on that merged main. C2-2 suitability translation, lash maps, extension blueprints, transcripts, follow-ups and commerce remain later work.

## Behavior and compatibility

Set `AI_CONSULT_FACE_COLOR_ENABLED=true` to request the companion after the existing feature read. All other values leave the existing two-call analysis path intact. Missing face views avoid the paid companion call. A provider timeout, refusal, malformed response or unsupported citation degrades the companion to UNKNOWN and preserves the consultation. Warned images cannot establish skin depth or surface overtone. Geometry supported by those images remains available.

The new immutable `ConsultFaceColorProfile` table pins one companion to one ANALYSIS revision. Finalize writes both in the same existing locked transaction, after the request-hash and plan-version checks. A failed or superseded finalize cannot leave companion evidence behind. The table uses RLS with no public policies and rejects updates, wrong-session/non-analysis pins, invalid observations and non-face evidence.

The authorized professional Brief reads only its source analysis's companion and merges the nine fields into its existing `profile`. Missing/unsupported companion rows yield UNKNOWN fields. Existing stored ANALYSIS/BRIEF payloads, their schema/prompt pins, the twelve original observations, and the client analysis DTO remain unchanged. New professional profile fields are optional on the wire, so historical iOS fixtures still decode. Existing web observation rendering supplies labels for the new fields. This is evidence display; new suitability reasoning and client wording remain C2-2.

## Release and rollback

Apply `20261025000000_consult_face_color_profile` before running the new server code; even with the provider flag off, professional Brief reads query the new table. The migration is additive and old server code can operate with it present. Disable the flag to stop new paid companion calls without deleting existing evidence. For code rollback, retain the added table/enum and roll back the server code. Do not deploy, archive iOS, or merge under this task's authorization.

The provider timeout budget becomes 50s inspiration + 45s profile + 30s companion + 150s direction = 275s within the existing 300s worker ceiling. One extra paid call is possible for each eligible analysis rerun. The existing per-consult rerun cap remains unchanged.

## Verification

Focused engine, historical revision, pro Brief/API and rendered-component tests cover activation, UNKNOWN fallback, image filtering, evidence rejection and historical rendering. PostgreSQL lifecycle tests cover exact analysis binding, constraints/RLS, immutable rows, flag-disabled reruns, changed input during provider work, and the active look-plan pipeline. Run the dedicated required-success live C2-1 test; it calls the real companion function with committed synthetic images and bypasses the optional fallback.

Also run typecheck, lint, static guards (including iOS fixture compatibility), and the pre-push full unit suite. A real-client/stylist quality evaluation, physical-device walkthrough, production migration and deployment are release work, not established by these synthetic checks.
