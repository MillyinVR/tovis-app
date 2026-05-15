# Enterprise Handoff Notes

This document captures the minimum context needed for engineers, operators, support, and future maintainers to understand the TOVIS launch-readiness state.

## Product-critical flows

The following flows are launch-critical:

1. Pro signup and verification.
2. Pro profile setup.
3. Pro service offering setup.
4. Pro location and availability publishing.
5. Client booking creation.
6. Pro booking acceptance.
7. Pro session start.
8. Consultation proposal and approval.
9. Before-photo upload.
10. Service-in-progress transition.
11. After-photo upload.
12. Aftercare creation and sending.
13. Checkout and payment closeout.
14. Booking completion.
15. Client rebooking/review where applicable.

## Safety-critical areas

The following areas must not be changed casually:

| Area | Why it matters |
|---|---|
| Auth/session handling | Incorrect changes can expose accounts or bypass verification. |
| Role guards | Incorrect changes can allow Clients, Pros, or Admins to access the wrong surfaces. |
| Booking lifecycle | Incorrect changes can create invalid booking states. |
| Idempotency | Incorrect changes can duplicate bookings, cancellations, payments, or notifications. |
| Media storage | Incorrect changes can expose private client/pro photos. |
| Aftercare tokens | Incorrect changes can expose private aftercare or rebooking links. |
| Stripe webhooks | Incorrect changes can corrupt payment state. |
| Notification delivery | Incorrect changes can silently fail client/pro communication. |
| Rate limiting | Incorrect changes can expose auth/SMS/media endpoints to abuse. |
| Health checks | Incorrect changes can hide outages. |

## Required launch evidence

Before public launch, collect evidence for:

- full 12-step E2E booking/session flow
- duplicate request/idempotency replay suite
- booking concurrency tests
- Stripe webhook replay test
- media privacy policy verification
- health readiness failure behavior
- notification delivery retry behavior
- rate-limit enforcement behavior
- Origin/Referer protection behavior
- onboarding/readiness gate behavior
- private beta dogfood completion
- rollback drill for at least one runtime change

## Known high-priority risks

The following items are not safe to ignore for public launch:

1. Health readiness checks must probe real dependencies.
2. Realtime or polling must update booking/session state without manual refresh.
3. Global abuse protection must protect auth, SMS, token, booking, and media routes.
4. Pro onboarding/readiness gates must prevent unready Pros from becoming bookable.
5. Stripe webhook effects must be atomic or safely replayable.
6. Aftercare send state must not claim success if delivery enqueue failed.
7. Private media policies must be verified in Supabase, not only represented in code.
8. Full E2E/load/chaos testing must exist before broad launch.
9. Privacy and retention policies must be documented before enterprise handoff.

## Change-control rule

Any change to auth, booking state, payment state, media access, notification delivery, or token access must include:

- implementation reference
- test evidence
- rollback notes
- owner
- known risks
- checklist update

If the checklist is not updated, the change is not launch-ready.

## Handoff owner

- Current launch-readiness owner: TBD
- Engineering owner: TBD
- Product owner: TBD
- Support owner: TBD
- Security/privacy owner: TBD
- Operations owner: TBD