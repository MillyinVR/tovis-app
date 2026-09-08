# Consult Cycle C — chart confirmation and hair mentor

Scope: P5h and P10b. This is a code release; deployment and a TestFlight archive require separate authorization. Leave Vercel automatic deployments disabled.

## Behavior

- A current, sufficiently complete chart from at least two completed visits earns a grouped history confirmation. New goals and upkeep preferences are still answered for the new look. The returning-client integration journey measures **two history-prep questions**: grouped confirmation, then reaction history. It does not count the new goal/upkeep choices as remembered history.
- “Only box dye at home; the other details are still right” retains the explicitly confirmed facts and asks the box-dye timing gap. Other changes return to fresh questions. Individual dated confirmations are supported in intake and adaptive follow-up cards.
- Candidates never silently become answers. Current client answers win. Relative timing buckets, unknown values and expired history are asked again. History expires after 365 days; a positive reported reaction does not expire. Pre-visit visual observations are not delivered results and cannot survive the completed visit as a current appearance fact.
- Chart copies use the original capture date for the 70-day photo window. Reuse requires an explicit dated confirmation and the standard upload/attach/quality gates. The Brief pins photo provenance to the exact captures consumed by its analysis version. Missing source timestamps fail closed.
- Cross-professional visit history requires granted chart sharing. Photo reuse remains within the canonical media boundary and the current professional’s private consultation chart copies. No public URL is stored as proof of access.
- The professional can save mentor on/off and up to 12 private product-line names under Profile. Hair Briefs show sections 1–5 only. All observations, preferences and path reasoning come from the Brief. Missing hairline evidence is an explicit in-person check. No formulation, mentor chat, product recommendation or KB retrieval is added.

## Audit corrections

The look-started booking path now creates durable chart copies after the booking link commits. Earlier chart copies no longer suppress accepted retakes. The current legal prerequisites and chart-copy choice are checked under the session lock before a durable write.

The iOS intake no longer treats its one visible question as the complete pack. Both clients preserve the current server revision and use server completeness checks.

## Rollout and rollback

Apply the `20261024000000` through `20261024000005` migrations before enabling either feature. Both flags default off:

```
AI_CONSULT_CHART_PREFILL_ENABLED=true
AI_CONSULT_MENTOR_ENABLED=true
```

Keep the existing founder pilot and Look Plan gates in place. Mentor also requires the professional’s own toggle. Disable the two new flags to stop offering chart shortcuts and mentor layers; preserve the append-only confirmation and analysis-provenance rows. Disabling a flag does not rewrite a previously confirmed client answer.

## Verification

Run typecheck, lint, static guards, the complete unit suite, and the affected PostgreSQL suites. `tests/integration/consult-chart-cycle-c.test.ts` exercises two completed visits, grouped and one-question confirmations, replay conflicts, corrections, access denial, mentor opt-in and photo reuse through a completed analysis/Brief. The fixture uses synthetic provider/storage responses; `tests/live/consult-capture-gate.test.ts` separately exercises real provider calls, including the exact early-photo entry used by reuse.

The built browser checks are `consult-chart-confirmation.spec.ts` and `consult-look-brief.spec.ts` on desktop and mobile Chrome. Native checks include the shared-code suite, `ConsultFlowViewModelTests`, and `ConsultMentorRenderTests`; inspect both rendered color schemes. The native render fixture is synthetic content projected from a real test-database Brief.

A physical-device walkthrough, production deployment and a new TestFlight archive are not implied by simulator/build checks. Cycle C deployment remains the next release checkpoint; Cycle D follows it in the handoff.
