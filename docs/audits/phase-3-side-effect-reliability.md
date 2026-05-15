```md
# Phase 3 Baseline - Side Effect Reliability

Branch: audit/phase-3-side-effect-reliability  
Based on Phase 2 commit: e0329cf

## Scope

Phase 3 stayed limited to booking-related side effect reliability.

## Findings

The repo already has durable notification infrastructure:

- `NotificationDispatch`
- `NotificationDelivery`
- `NotificationDeliveryEvent`
- `ScheduledClientNotification`
- idempotent dispatch source keys
- delivery retry/final failure states
- delivery processor route
- scheduled client reminder job route

Phase 3 did not add a new outbox table because the existing dispatch/delivery foundation already provides durable delivery rows, per-channel delivery state, retry/failure accounting, and scheduled client notification processing.

## Implemented

- Hardened scheduled client reminder retry behavior.
- Changed failed reminder processing attempts to keep `failedAt` null.
- Preserved `lastError` for observability.
- Kept API attempt summary behavior reporting failed attempts.
- Left `processedAt` and `cancelledAt` untouched on retryable failures.
- Verified booking-related notification and delivery paths with targeted tests.
- Verified the full repo test suite after readiness/booking write-boundary updates.

## Why

The client reminder job only loads rows where:

- `processedAt` is null
- `failedAt` is null
- `cancelledAt` is null
- `runAt` is due

Before Phase 3, a transient reminder processing error set `failedAt`, which permanently removed the row from future processing. Phase 3 makes those failures retryable by default while still recording `lastError`.

That gives the reminder job the behavior we actually want: fail loudly enough to debug, but do not silently exile the reminder row forever because one provider sneezed. Tiny mercy. Huge difference.

## Targeted test command

```bash
pnpm vitest run app/api/internal/jobs/client-reminders/route.test.ts lib/clientActions/orchestrateClientActionDelivery.test.ts lib/notifications/appointmentReminders.test.ts lib/notifications/clientNotifications.test.ts lib/notifications/proNotifications.test.ts lib/notifications/proNotificationQueries.test.ts lib/notifications/dispatch/enqueueDispatch.test.ts lib/notifications/delivery/completeDeliveryAttempt.test.ts lib/notifications/delivery/renderNotificationContent.test.ts lib/notifications/delivery/sendEmail.test.ts lib/notifications/delivery/sendSms.test.ts lib/notifications/webhooks/applyDeliveryWebhookUpdate.test.ts