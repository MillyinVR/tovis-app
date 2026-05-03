# Phase 3 Baseline - Side Effect Reliability

Branch: audit/phase-3-side-effect-reliability
Based on Phase 2 commit: e0329cf

## Scope

Phase 3 stayed limited to booking-related side effect reliability.

## Findings

The repo already has durable notification infrastructure:

- NotificationDispatch
- NotificationDelivery
- NotificationDeliveryEvent
- ScheduledClientNotification
- idempotent dispatch source keys
- delivery retry/final failure states
- delivery processor route
- scheduled client reminder job route

Phase 3 did not add a new outbox table because the existing dispatch/delivery foundation already provides durable delivery rows, per-channel delivery state, and retry/failure accounting.

## Implemented

- Hardened scheduled client reminder retry behavior.
- Changed failed reminder processing attempts to keep `failedAt` null.
- Preserved `lastError` for observability.
- Kept API attempt summary behavior reporting failed attempts.
- Left `processedAt` and `cancelledAt` untouched on retryable failures.

## Why

The client reminder job only loads rows where:

- `processedAt` is null
- `failedAt` is null
- `cancelledAt` is null
- `runAt` is due

Before Phase 3, a transient reminder processing error set `failedAt`, which permanently removed the row from future processing. Phase 3 makes those failures retryable by default while still recording `lastError`.

## Targeted test command

pnpm vitest run app/api/internal/jobs/client-reminders/route.test.ts lib/clientActions/orchestrateClientActionDelivery.test.ts lib/notifications/appointmentReminders.test.ts lib/notifications/clientNotifications.test.ts lib/notifications/proNotifications.test.ts lib/notifications/proNotificationQueries.test.ts lib/notifications/dispatch/enqueueDispatch.test.ts lib/notifications/delivery/completeDeliveryAttempt.test.ts lib/notifications/delivery/renderNotificationContent.test.ts lib/notifications/delivery/sendEmail.test.ts lib/notifications/delivery/sendSms.test.ts lib/notifications/webhooks/applyDeliveryWebhookUpdate.test.ts

Result:

PASS - 12 test files passed, 123 tests passed.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new side-effect or reminder job type errors were observed.

Expected baseline:

Phase 0 documented existing Looks/feed viewerSaved type errors. Those are out of scope for Phase 3 unless new side-effect or reminder job errors appear.

## Phase 3 completion criteria

- Existing durable notification dispatch infrastructure confirmed.
- Existing side-effect baseline tests pass.
- Scheduled reminder processing failures remain retryable.
- Reminder job records `lastError` for failed attempts.
- Failed attempts do not permanently remove rows from future processing.
- Targeted Phase 3 tests pass.
