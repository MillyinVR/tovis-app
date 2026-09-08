import type { Prisma } from '@prisma/client'
import type { ConsultLookCompletedVisitDTO } from '@/lib/dto/consult'
import { moneyToFixed2String } from '@/lib/money'

/** Call only inside the already-authorized client/pro consultation reader. */
export async function loadConsultLookCompletedVisit(tx: Prisma.TransactionClient, consultSessionId: string): Promise<ConsultLookCompletedVisitDTO | null> {
  const outcome = await tx.consultLookVisitOutcome.findFirst({ where: { consultSessionId }, orderBy: { completedAt: 'desc' }, select: {
    bookingId: true, lookBriefVersionId: true, observedServiceMinutes: true, finalServiceSubtotal: true, completedAt: true,
    booking: { select: { aftercareSummary: { select: { notes: true, sentToClientAt: true,
      careSections: { orderBy: { sortOrder: 'asc' }, select: { label: true, body: true } },
      recommendedProducts: { select: { externalName: true, note: true, product: { select: { name: true } } } },
    } } } },
  } })
  if (!outcome) return null
  const care = outcome.booking.aftercareSummary
  return { bookingId: outcome.bookingId, lookBriefVersionId: outcome.lookBriefVersionId,
    observedServiceMinutes: outcome.observedServiceMinutes, finalServiceSubtotal: moneyToFixed2String(outcome.finalServiceSubtotal),
    completedAt: outcome.completedAt.toISOString(),
    // A draft aftercare plan is private to the pro until explicitly sent.
    aftercare: care?.sentToClientAt ? { notes: care.notes, sections: care.careSections,
      products: care.recommendedProducts.flatMap(item => {
        const name = item.product?.name ?? item.externalName
        return name ? [{ name, note: item.note }] : []
      }),
    } : null,
  }
}
