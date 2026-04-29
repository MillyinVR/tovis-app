# Booking Lifecycle Contract

> **Canonical reference** for all UI copy, API naming, and test assertions.  
> Source of truth: `lib/booking/lifecycleContract.ts`

---

## BookingStatus flow

```
PENDING ──(accept)──► ACCEPTED ──(start)──► IN_PROGRESS ──(complete)──► COMPLETED
   │                     │                       │
   └──(cancel)──►        └──(cancel)──►          └──(cancel, admin only)──►
                    CANCELLED              CANCELLED
```

| From | To | Allowed actors | Canonical verb |
|---|---|---|---|
| `PENDING` | `ACCEPTED` | PRO, ADMIN, SYSTEM | Accept booking |
| `PENDING` | `CANCELLED` | PRO, CLIENT, ADMIN | Cancel booking |
| `ACCEPTED` | `IN_PROGRESS` | PRO | Start booking |
| `ACCEPTED` | `CANCELLED` | PRO, CLIENT, ADMIN | Cancel booking |
| `IN_PROGRESS` | `COMPLETED` | PRO, ADMIN, SYSTEM | Complete booking (via send aftercare) |
| `IN_PROGRESS` | `CANCELLED` | ADMIN | Admin cancel (emergency only) |

---

## SessionStep ladder (while status = IN_PROGRESS)

```
NONE
 │  startBookingSession()
 ▼
CONSULTATION
 │  "Send consultation proposal"
 ▼
CONSULTATION_PENDING_CLIENT
 │  "Approve consultation" (client via secure link or in-person)
 ▼                               ◄── "Revise" (PRO can walk back to CONSULTATION)
BEFORE_PHOTOS
 │  "Start service" (after before-media confirmed)
 ▼
SERVICE_IN_PROGRESS
 │  "Finish service"
 ▼
FINISH_REVIEW
 │  "Create aftercare" (uploads after-media)
 ▼
AFTER_PHOTOS
 │  "Send aftercare + complete booking"
 ▼
DONE  →  BookingStatus = COMPLETED, finishedAt = now
```

| From | To | Allowed actors | Canonical verb |
|---|---|---|---|
| `NONE` | `CONSULTATION` | PRO | Start booking |
| `CONSULTATION` | `CONSULTATION_PENDING_CLIENT` | PRO | Send consultation proposal |
| `CONSULTATION_PENDING_CLIENT` | `BEFORE_PHOTOS` | CLIENT, PRO | Approve consultation |
| `CONSULTATION_PENDING_CLIENT` | `CONSULTATION` | PRO | Revise proposal |
| `BEFORE_PHOTOS` | `SERVICE_IN_PROGRESS` | PRO | Start service |
| `SERVICE_IN_PROGRESS` | `FINISH_REVIEW` | PRO | Finish service |
| `FINISH_REVIEW` | `AFTER_PHOTOS` | PRO | Create aftercare / upload after photos |
| `AFTER_PHOTOS` | `DONE` | PRO, ADMIN, SYSTEM | Send aftercare + complete booking |

---

## Canonical verb labels

Use these exact labels in all UI buttons, toast messages, API response `userMessage` fields, and test descriptions.

| Action | Label |
|---|---|
| `startBookingSession()` | "Start booking" |
| `transitionSessionStep(CONSULTATION → CONSULTATION_PENDING_CLIENT)` | "Send consultation proposal" |
| `approveConsultationByClientActionToken()` | "Approve consultation" |
| `transitionSessionStep(BEFORE_PHOTOS → SERVICE_IN_PROGRESS)` | "Start service" |
| `finishBookingSession()` | "Finish service" |
| `upsertBookingAftercare(sendToClient: false)` | "Save aftercare draft" |
| `upsertBookingAftercare(sendToClient: true)` when payment not collected | "Send aftercare" (booking NOT completed) |
| `upsertBookingAftercare(sendToClient: true)` when payment collected | "Send aftercare + complete booking" |

> ⚠️ **Never** label `finishBookingSession` as "complete booking".  
> Booking completes only after aftercare is sent AND payment is collected.

---

## Key invariants

1. **`status = COMPLETED`** is set only when ALL of: `finishedAt` is set, `aftercareSentAt` is set, `paymentCollectedAt` is set, and `checkoutStatus` is a valid closeout state.  
2. **`sessionStep = DONE`** always co-occurs with `status = COMPLETED`.  
3. **`status = IN_PROGRESS`** means `startedAt` is set and `finishedAt` is null.  
4. **Consultation approval** is required before advancing past `BEFORE_PHOTOS`.  
5. **Media guard**: `BEFORE_PHOTOS → SERVICE_IN_PROGRESS` is only allowed after at least one `MediaAsset` with `phase = BEFORE` exists.  
6. **Payment not collected error**: if `sendToClient = true` but `paymentCollectedAt` is null or `checkoutStatus` is not a valid closeout state, the route must return `PAYMENT_NOT_COLLECTED` and surface the message "Payment not collected — finish checkout before completing booking".

---

## Hold → Finalize → Booking creation

```
createHold()          POST /api/holds
    │
    │  (expires in 10 min)
    ▼
finalizeBookingFromHold()    POST /api/bookings/finalize
    │  • acquires professional advisory lock
    │  • deletes hold
    │  • creates Booking + BookingServiceItem rows
    │  • status = PENDING or ACCEPTED (depending on autoAcceptBookings)
    ▼
Booking created
```

The hold is the idempotency token for creation. Two simultaneous finalize requests on the same hold will be serialized by the advisory lock; the second will receive `HOLD_NOT_FOUND`.  
Clients **must** send `Idempotency-Key: <uuid>` on all finalize requests so retries can be traced in logs.

---

## Pro-created booking path

```
createProBooking()    POST /api/pro/bookings
    │  • same advisory lock as finalize
    │  • same conflict detection (conflicts.ts)
    │  • same slot readiness checks (slotReadiness.ts)
    │  • status = ACCEPTED immediately
    ▼
Booking created (status = ACCEPTED)
```

---

## Notification events sent per lifecycle step

| Lifecycle event | Recipient | `NotificationEventKey` |
|---|---|---|
| Booking created (PENDING) | PRO | `BOOKING_REQUEST_CREATED` |
| Booking accepted (ACCEPTED) | CLIENT | `BOOKING_CONFIRMED` |
| Session started (IN_PROGRESS) | CLIENT | `BOOKING_STARTED` |
| Consultation proposal sent | CLIENT | `CONSULTATION_PROPOSAL_SENT` |
| Consultation approved | PRO | `CONSULTATION_APPROVED` |
| Aftercare sent | CLIENT | `AFTERCARE_READY` |
| Booking cancelled | CLIENT/PRO | `BOOKING_CANCELLED_BY_PRO` / `BOOKING_CANCELLED_BY_CLIENT` |
