# Private Beta Support And Rollback

Phase: Phase 2 — Launch ops proof  
Scope: Controlled private beta  
Current status: TEMPLATE READY / HUMAN DECISIONS TODO  
Primary owner: Tori  
Backup owner: NONE — accepted private-beta risk; public rollout blocker  

This document turns the support and rollback blockers into concrete decision fields. It does not make the decisions for Tori.

Private beta remains NO-GO until the decision-required rows below are completed or explicitly accepted in `docs/launch-readiness/go-no-go.md`.

---

# Support Path

| Item | Current value | Launch impact |
|---|---|---|
| Primary support owner | Tori | Ready for private beta if support hours/channel are defined |
| Backup support owner | NONE | Accepted private-beta risk only; blocks public rollout |
| Support hours | DECISION REQUIRED | Blocks private beta |
| Off-hours behavior | DECISION REQUIRED | Blocks private beta |
| Support channel | DECISION REQUIRED | Blocks private beta |
| Bug intake path | DECISION REQUIRED | Blocks private beta |
| Payment issue path | DECISION REQUIRED if payments enabled | Blocks private beta if payments enabled |
| Refund/manual payment handling | DECISION REQUIRED if payments enabled | Blocks private beta if payments enabled |
| Privacy request escalation | DECISION REQUIRED | Blocks private beta |
| User-impact comms path | DECISION REQUIRED | Blocks private beta |
| Beta participant expectations | DECISION REQUIRED | Blocks private beta |

## Recommended private-beta minimum

Use these as the lowest-friction founder-operated defaults if Tori accepts them:

| Item | Recommended value |
|---|---|
| Beta cohort size | 5 to 10 known users/pros for the first window |
| Support hours | One explicitly named daily support window |
| Support channel | One monitored channel or inbox, separate from `#tovis-ops-alerts` |
| Bug intake | One form, issue tracker, or support thread with severity label |
| P1 response | Pause beta flow, acknowledge in ops channel, use runbook, decide rollback |
| P2 response | Triage during support window and communicate workaround |
| Off-hours behavior | Pause invites and disclose delayed response unless P1 impacts active users |

If Tori chooses different values, record them here and mirror the decision in `private-beta-checklist.md`.

## Support evidence template

```md
## Support path decision — private beta

Status: PASS / ACCEPTED RISK / BLOCKED
Date:
Owner: Tori
Support hours:
Support channel:
Bug intake:
Payment issue path:
Privacy request path:
Off-hours behavior:
Known limitations:
Accepted risks:
Launch decision:
```

---

# Rollback And Pause Path

| Item | Current value | Launch impact |
|---|---|---|
| Rollback owner | Tori | Ready for private beta if process is documented |
| Backup rollback owner | NONE | Accepted private-beta risk only; blocks public rollout |
| Last known good commit/deploy | DECISION REQUIRED | Blocks private beta |
| Deploy rollback process | DECISION REQUIRED | Blocks private beta |
| Private beta pause process | DECISION REQUIRED | Blocks private beta |
| Feature disable/kill-switch strategy | DECISION REQUIRED | Blocks private beta |
| Payment/webhook rollback note | DECISION REQUIRED if payments enabled | Blocks private beta if payments enabled |
| Media/storage rollback note | DECISION REQUIRED if media enabled | Blocks private beta if media enabled |
| Notification disable/manual follow-up | DECISION REQUIRED if notifications enabled | Blocks private beta if notifications enabled |
| User communication path | DECISION REQUIRED | Blocks private beta |
| Post-rollback smoke checklist | TEMPLATE READY | Fill with deployed proof links after a rollback drill or accepted process review |

## Pause triggers

Pause private beta immediately if any of these occur:

| Trigger | Severity | First action |
|---|---|---|
| Health/readiness regresses | P1 | Pause invites, check dashboard, open health runbook |
| Booking finalize failure threshold breached | P1 | Pause booking flow or beta invites, open booking runbook |
| Confirmed double booking | P1 | Stop booking writes if needed, preserve evidence, investigate data integrity |
| Stripe webhook/payment correctness issue | P1 | Stop payment-dependent flow, reconcile Stripe/app state |
| Private media access regression | P1 | Stop rollout, revoke/rotate access where needed, open private media incident runbook |
| Export/delete auth regression | P1 | Disable internal route access if needed, open privacy request runbook |
| Notification backlog blocks critical user action | P2/P1 | Use manual follow-up path and provider runbook |
| Sentry/Slack alert route breaks during support window | P1 | Pause beta until owner can see launch-critical failures |
| Support path unavailable during active beta window | P2/P1 | Pause new invites and communicate response delay |

## Rollback evidence template

```md
## Rollback path decision — private beta

Status: PASS / ACCEPTED RISK / BLOCKED
Date:
Owner: Tori
Last known good commit/deploy:
Deploy rollback steps:
Pause process:
Feature disable strategy:
Payment/webhook notes:
Media/storage notes:
Notification notes:
User communication path:
Post-rollback smoke checks:
Known limitations:
Accepted risks:
Launch decision:
```

## Post-rollback smoke checklist

After rollback or pause, verify:

1. `/api/health/live` returns controlled success.
2. `/api/health/ready` returns controlled success or expected degradation.
3. Sentry intake still works or an accepted alternate alert path is active.
4. Booking availability and finalize path behave according to chosen pause state.
5. Payment/webhook state is consistent if payments are enabled.
6. Private media remains inaccessible outside authorized boundaries if media is enabled.
7. Notifications are delivered or manual follow-up is active if notifications are enabled.
8. Support channel has the current user-impact message.
9. `go-no-go.md` and `risk-register.md` are updated before resuming.

---

# User Communication Templates

Use these as short starting points. Edit names/timing before sending.

## Pause message

```text
We paused the private beta while we investigate an issue affecting <area>. Your existing information is protected, and we will update you by <time>. Please use <support channel> for urgent questions.
```

## Resolved message

```text
The issue affecting <area> has been resolved. We verified <checks> and are resuming the private beta. If you notice anything unusual, contact us through <support channel>.
```

## Workaround message

```text
We found an issue affecting <area>. The temporary workaround is <workaround>. We will follow up when the permanent fix is verified.
```

