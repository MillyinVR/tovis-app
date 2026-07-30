// The client chart's booking-history row shape, in ONE place.
//
// Two surfaces read the same history: the server-rendered web chart
// (app/pro/clients/[id]/page.tsx) and its native twin
// (GET /api/v1/pro/clients/[id]/chart). They were maintaining two hand-copied
// Prisma selects that had already drifted — the API's copy silently missed K5's
// `clientRelationshipLabel`, so the NR/NNR/RR/RNR mark existed on web and could
// not exist on device. A shared select is the fix AND the guard: a column added
// for one surface can no longer be absent from the other by omission.
//
// Both surfaces additionally feed `computeRelationshipIntelligence`, which is
// why `createdAt` (lead time = scheduledFor − createdAt), `finishedAt` and the
// money columns are here rather than at either call site.

import type { Prisma } from '@prisma/client'

import { RELATIONSHIP_BADGE_SELECT } from '@/lib/booking/relationshipLabel'

export const CHART_BOOKING_SELECT = {
  id: true,
  status: true,
  // Relationship-badge input: only the K5 snapshot column, by design — the mark
  // is a per-booking SNAPSHOT and must never grow a dependency on live history.
  ...RELATIONSHIP_BADGE_SELECT,
  scheduledFor: true,
  locationTimeZone: true,
  createdAt: true,
  finishedAt: true,
  totalDurationMinutes: true,
  totalAmount: true,
  subtotalSnapshot: true,
  professionalId: true,
  service: {
    select: {
      name: true,
      category: {
        select: {
          name: true,
        },
      },
    },
  },
  professional: {
    select: {
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: names the PRO on a history row ("with Ana R."); plaintext-by-schema, and the fallback when businessName is unset
      lastName: true, // pii-plaintext-read-ok: names the PRO on a history row ("with Ana R."); plaintext-by-schema, and the fallback when businessName is unset
    },
  },
  aftercareSummary: {
    select: {
      notes: true,
    },
  },
} satisfies Prisma.BookingSelect

export type ChartBookingRow = Prisma.BookingGetPayload<{
  select: typeof CHART_BOOKING_SELECT
}>
