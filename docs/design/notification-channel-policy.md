# Notification Channel Policy — SSOT

> Status: **DECIDED / partially implemented.** This is the source of truth for which
> notification events go to which channels, per recipient. Author session: 2026-06-20.
> Implemented by Prompts A–D (see end). Where code and this doc disagree, **this doc
> wins** — fix the code (`lib/notifications/eventKeys.ts`) to match.

## Why this exists

To prevent notification bombardment and keep channel choice deliberate. Every channel
has a cost (money, attention, trust). The catalog already carries the primitives to
express this — each event in `lib/notifications/eventKeys.ts` has `transactional`,
`defaultPriority`, and `allowQuietHoursBypass`. This doc defines the policy those
flags serve.

## Channel philosophy (the rules behind the rules)

- **In-app = the ledger.** *Every* event creates an in-app record. Zero cost, zero
  intrusion — it's the inbox/feed. Always on.
- **Push (native, future) = the primary "buzz."** Free, dismissible, the natural home
  for anything worth interrupting an app user for. When push ships, it **replaces most
  SMS** for users who have the app installed; SMS becomes the fallback when there's no
  push token. **Not yet built — do NOT add `PUSH` to the Prisma `NotificationChannel`
  enum until native push is implemented.** It is documented here so events slot in
  cleanly later (push covers every Tier-A/B event + opted-in Tier-C).
- **SMS = expensive + intrusive → ration hard.** Reserve for (1) genuinely
  time-critical transactional alerts (the "Moderate" posture below), and (2) the *only*
  way to reach **phone-only / unclaimed clients** (magic-link cases).
- **Email = durable record.** Receipts, confirmations, detail worth keeping. Never
  social/low-value.

## Decisions locked (2026-06-20)

- **SMS posture: Moderate.** SMS for appointment reminders, booking cancellations, and
  reschedules (real schedule disruptions) + payment-action-required + unclaimed
  magic links. NOT for confirmations/receipts/social.
- **Last-minute openings: in-app + opt-in push.** No SMS, no email.
- **Quiet hours: default 22:00–08:00 recipient-local, urgent (Tier A) bypasses.**
  User-overridable — clients/pros can disable quiet hours or set a custom window via
  the preferences UI (Prompt C). Default applies until a preference row overrides it.
  **Exception:** appointment reminders, though Tier A for SMS-eligibility, do **not**
  bypass quiet hours — a reminder caught in the window defers to the window's end
  rather than waking the recipient. Only schedule-disruption + payment-action events
  bypass.
- **Review received (pro): in-app + push only.** No email.

## Legend

`I` = in-app (always) · `E` = email · `S` = SMS · `P` = push (native, future) ·
**bold event** = bypasses quiet hours (Tier A urgent).

## Tier A — Urgent transactional (gets SMS under Moderate)

| Event | Client | Pro |
|---|---|---|
| Appointment reminder | I E S P | I P |
| **Booking request created** | — | I E S P |
| **Booking rescheduled** | I E S P | I E S P |
| **Booking cancelled** (→ the *affected* party) | I E S P | I E S P |
| **Payment action required** | I E S P | I E P |

## Tier B — Confirmations & receipts (no SMS for app users)

| Event | Client | Pro |
|---|---|---|
| Booking confirmed | I E P | I E P |
| Booking started | I P | — |
| Consultation approved / rejected | I E P | I E P |
| Payment collected (receipt) | I E P | I E P |
| Payment refunded (receipt) | I E P | I E P |
| Booking cancelled (→ the *actor* who did it) | I E | I E |

## Tier C — Social / informational (in-app always; push only if opted into social; never SMS/email)

| Event | Client | Pro |
|---|---|---|
| Review received | — | I P |
| New follower (look / client) | I P | I P |
| Viral request approved | — | I P |
| Referral tap / confirmed / converted | I (P opt-in) | — |
| Last-minute opening | I (P opt-in) | — |

## Magic-link carve-out (phone-only / unclaimed clients)

SMS here is the **only** way to reach the recipient (no app, often no email) — it is
gated on "no app/email available," NOT on the Moderate rule.

| Event | Channels |
|---|---|
| Client claim invite | S E |
| Consultation proposal sent | I E S P |
| Aftercare ready | I E S P |

**Pro-created bookings for unclaimed clients.** A pro booking for an unclaimed client
auto-creates a **claim invite** (above), which is SMS-capable and links to the
booking's public claim/overview page — that invite **is** the booking notification for
that client. The Tier-B `BOOKING_CONFIRMED` (in-app + email, no SMS) is therefore sent
**only to claimed clients**; we do not also send it to unclaimed clients (they have no
app target, get no confirmation SMS by policy, and would otherwise get a dead/duplicate
send). See `lib/booking/createProBookingWithClient.ts`.

## Two refinements this policy encodes

1. **Cancellations split by recipient.** The person who *did* the cancellation gets a
   calm `I E` confirmation (Tier B); the *affected* party gets the urgent `I E S P`
   (Tier A). Implemented via per-recipient `defaultChannelsByRecipient` on the
   `BOOKING_CANCELLED_BY_*` events:
   - `BOOKING_CANCELLED_BY_CLIENT`: client (actor) = I E · pro (affected) = I E S P
   - `BOOKING_CANCELLED_BY_PRO`: pro (actor) = I E · client (affected) = I E S P
   - `BOOKING_CANCELLED_BY_ADMIN`: both affected = I E S P
2. **Push is a column, not a migration.** Push is planned for every Tier-A/B event and
   opted-in Tier-C, but `PUSH` is not added to the Prisma enum until native push is
   built. No schema churn today.

## Consent & gating (must hold at dispatch)

- **SMS requires consent + a verified phone.** Gate SMS selection on
  `User.transactionalSmsConsentAt` AND `phoneVerifiedAt` (not phone-verified alone).
  The existing Twilio launch-gate still applies on top.
- **Preferences override defaults.** Once a `ClientNotificationPreference` /
  `ProfessionalNotificationPreference` row exists, it overrides these defaults
  (per-channel toggles + quiet hours). The engine already reads these tables; the
  read/write UI is Prompt C.

## Implementation status & prompts

- **Prompt A** — delivery reliability: build the provider registry conditionally so a
  missing SMS/email provider can't take down in-app delivery; unify env config. (Not
  a policy change; reliability prerequisite.)
- **Prompt B** — codify this policy in `lib/notifications/eventKeys.ts`; enforce SMS
  consent; set the 22:00–08:00 quiet-hours default.
- **Prompt C** — notification preferences settings UI (per-channel toggles + quiet
  hours override) for client + pro.
- **Prompt D** — wire up `PAYMENT_COLLECTED` / `PAYMENT_ACTION_REQUIRED` (already in
  enum) and add `PAYMENT_REFUNDED` (new event key — needs schema coordination).

## Open / future

- **Admin notifications.** No `ADMIN` recipient kind exists today. Out of scope for
  Prompts A–D; tracked separately (email-only alerts for pending license/verification
  review, support tickets, pending viral-service requests).
- **Native push delivery.** Add `PUSH` channel + provider (APNs/FCM) + push-token
  model when iOS/Android ship; map to the tiers above.
- **Consolidate the two client preference models** (`ClientNotificationSettings` vs
  `ClientNotificationPreference`) to avoid drift.
