/**
 * Intentional violation fixture for tools/check-lifecycle-field-writes.mjs.
 *
 * This file is allowlisted by the guard because it lives under tools/fixtures.
 * To manually verify the guard fails correctly, copy this example into a
 * non-allowlisted path, for example:
 *
 *   cp tools/fixtures/lifecycle-field-write-violation.ts tmp-lifecycle-violation.ts
 *   pnpm check:lifecycle-field-writes
 *   rm tmp-lifecycle-violation.ts
 *
 * The guard should fail while tmp-lifecycle-violation.ts exists.
 */

import { BookingStatus, SessionStep } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export async function unsafeLifecycleFieldWriteFixture(bookingId: string) {
  return prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })
}