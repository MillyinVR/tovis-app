# Verification and Onboarding Policy

This document defines the launch-readiness policy for Pro verification, Pro onboarding, marketplace visibility, and booking-sensitive access.

The purpose is to make one clear decision tree for when a Pro may become visible, bookable, and allowed to perform booking-critical actions.

This policy must be implemented before public launch.

## Scope

This policy applies to:

- Pro signup
- Pro verification state
- Pro profile completion
- Pro service offering setup
- Pro location setup
- Pro schedule and availability publishing
- Marketplace visibility
- Client booking eligibility
- Pro-created booking eligibility
- Booking acceptance
- Session start
- Checkout/payment readiness where required

## Goals

1. Prevent unready Pros from appearing bookable.
2. Prevent incomplete Pros from creating or accepting bookings.
3. Make readiness blockers clear and actionable.
4. Keep readiness logic centralized.
5. Avoid duplicating readiness checks across pages, routes, and components.
6. Make support/admin override behavior explicit.
7. Make launch behavior safe for real users at scale.

## Non-goals

This document does not define:

- license verification provider implementation
- admin dashboard design
- payment provider onboarding screens
- marketing profile quality scoring
- search ranking
- Pro subscription or monetization policy

Those may depend on this policy, but they should be documented separately.

---

# Definitions

## Pro

A user with role `PRO` and a related professional profile.

## Ready Pro

A Pro who satisfies all launch-required readiness checks and is allowed to become bookable.

## Bookable

A Pro is bookable when clients can create bookings with them or when the Pro can create bookings that represent real appointments.

## Marketplace visible

A Pro is marketplace visible when clients can discover them in search, maps, public profile pages, or booking entry points.

Marketplace visibility and bookability are related but not identical.

A Pro may be profile-visible but not bookable.

## Booking-sensitive route

A route, page, API, or action that can create, modify, accept, start, complete, or materially affect a real booking.

Examples:

- create hold
- finalize booking
- create Pro booking
- accept booking
- start session
- send consultation proposal
- approve consultation in person
- upload booking media
- send aftercare
- collect payment
- create checkout session
- publish schedule
- publish location
- publish offering

## Soft blocker

A blocker that should be shown to the Pro but does not prevent access.

Example:

- missing optional bio
- missing profile photo
- no social links
- incomplete marketing copy

## Hard blocker

A blocker that prevents marketplace bookability or booking-sensitive actions.

Example:

- missing bookable location
- no active offering
- no working hours
- invalid timezone
- rejected verification state
- required payment setup incomplete

---

# Policy summary

A Pro may not be bookable until all hard readiness blockers are resolved.

A Pro may be allowed to edit setup pages while blocked.

A Pro should receive clear blocker messages and links to the exact page where each blocker can be fixed.

A Pro should not discover a blocker only after a client attempts to book them.

---

# Verification policy

## Verification statuses

The app may support verification states such as:

- not started
- pending
- manual review
- approved
- rejected
- needs info

Use the actual enum names from the Prisma schema when implementing this policy.

Do not invent new string literals in application code.

## Public launch policy

For public launch, bookability depends on both the Pro's verification state and the booking entry point.

The product separates:

1. broad discovery bookability
2. intentional direct bookability
3. Pro-created booking ability

This allows TOVIS to avoid broadly promoting Pros who are still pending or under manual review, while still allowing real-world clients to book a specific Pro they already know or intentionally accessed.

## Booking entry point types

| Entry point type | Meaning | Examples |
|---|---|---|
| Broad discovery | Client finds the Pro through general marketplace browsing or recommendation surfaces. | discovery feed, generic search feed, map browsing, category browsing, homepage recommendations |
| Specific search | Client intentionally searches for a specific Pro or business by name, handle, phone-linked profile, direct identifier, or similarly explicit lookup. | exact-name search, handle search, direct profile lookup |
| Direct access | Client reaches the Pro through a direct offline or shared path. | NFC card, short code, QR code, direct profile link |
| Pro-created | Pro creates or schedules the booking themselves. | Pro backend booking creation |

## Verification behavior by entry point

| Verification state | Broad discovery visible | Specific search bookable | Direct access bookable | Pro-created booking allowed | Notes |
|---|---:|---:|---:|---:|---|
| Not started | No | No | No | No | Pro must begin verification/setup. |
| Pending | No | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Not promoted broadly, but intentional booking is allowed. |
| Manual review | No | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Not promoted broadly, but intentional booking is allowed. |
| Approved | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Yes, if all other readiness checks pass | Fully bookable. |
| Needs info | No | No | No | No | Pro must resolve verification issue. |
| Rejected | No | No | No | No | Pro must contact support or restart if allowed. |

## Policy rule

Pending/manual-review Pros are not eligible for broad discovery surfaces.

Pending/manual-review Pros may be booked only through intentional paths if all other readiness checks pass.

Intentional paths are:

- specific client search
- direct profile access
- NFC card
- short code
- QR code
- Pro-created booking

Rejected, needs-info, and not-started Pros are not bookable through any path.

Approved Pros may be broadly discoverable and bookable if all other readiness checks pass.

## Private beta policy

Private beta may use narrower access rules than public launch, but it should not use looser readiness rules unless the exception is explicitly documented.

For private beta, the team may limit intentional booking access to:

1. manually invited Pros
2. allowlisted beta Pros
3. internal test Pros
4. specific geographic launch areas
5. specific service categories

Private beta must still enforce hard blockers for:

- rejected verification
- needs-info verification
- not-started verification
- missing payment setup where payment is required
- missing active offering
- missing valid location
- missing working hours
- invalid timezone
- invalid schedule or availability
- unsafe booking conflicts

If private beta allows any exception beyond the public-launch policy, the exception must be tracked as a launch risk with an owner and expiration date.
## Decision

Pending/manual-review Pros may be bookable only through intentional/direct paths.

They may not appear in broad discovery feeds or generic marketplace recommendations.

### Allowed booking paths for pending/manual-review Pros

Pending/manual-review Pros may be booked through:

- specific client search
- direct profile access
- NFC card
- short code
- QR code
- Pro-created booking

only if all other readiness checks pass.

### Disallowed booking paths for pending/manual-review Pros

Pending/manual-review Pros must not be bookable through:

- broad discovery feeds
- generic marketplace browsing
- category browsing
- map browsing
- homepage recommendations
- algorithmic recommendations

### Reason

This policy balances safety with real-world behavior.

A pending/manual-review Pro should not be broadly promoted by the platform, but if a client intentionally seeks that Pro out or physically taps their NFC card, the booking is treated as a direct relationship rather than platform discovery.

### Implementation requirement

The readiness evaluator must distinguish the booking source or entry point.

with this:

````md
Recommended source categories:

```text
BROAD_DISCOVERY
SPECIFIC_SEARCH
DIRECT_PROFILE
NFC_CARD
SHORT_CODE
QR_CODE
PRO_CREATED