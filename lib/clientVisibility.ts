// lib/clientVisibility.ts
import { prisma } from '@/lib/prisma'

export type ClientVisibilityReason = 'ACTIVE_BOOKING' | 'PENDING_BOOKING' | 'UPCOMING_ACCEPTED' | 'NONE'

export type ClientVisibilityResult = {
  canViewClient: boolean
  reason: ClientVisibilityReason
}

function visibilityOr(now: Date) {
  return [
    { status: 'PENDING' as any },
    { startedAt: { not: null }, finishedAt: null },
    { status: 'ACCEPTED' as any, scheduledFor: { gte: now } },
  ] as const
}

/**
 * Policy:
 * Pro can view client ONLY if they have:
 * - booking currently in progress (startedAt != null AND finishedAt == null), OR
 * - PENDING booking, OR
 * - ACCEPTED upcoming booking
 *
 * Priority (deterministic):
 * ACTIVE > PENDING > UPCOMING_ACCEPTED
 *
 * ✅ Single query version (avoid 3 separate DB hits)
 */
export async function getProClientVisibility(proId: string, clientId: string): Promise<ClientVisibilityResult> {
  const now = new Date()

  const hit = await prisma.booking.findFirst({
    where: {
      clientId,
      professionalId: proId,
      OR: visibilityOr(now) as any,
    },
    select: {
      status: true,
      startedAt: true,
      finishedAt: true,
      scheduledFor: true,
    },
    // No need to order; we compute priority deterministically below.
  })

  if (!hit) return { canViewClient: false, reason: 'NONE' }

  // Priority: ACTIVE > PENDING > UPCOMING_ACCEPTED
  if (hit.startedAt && !hit.finishedAt) return { canViewClient: true, reason: 'ACTIVE_BOOKING' }

  const status = String(hit.status || '').toUpperCase()
  if (status === 'PENDING') return { canViewClient: true, reason: 'PENDING_BOOKING' }

  // Remaining allowed case in the OR is ACCEPTED + upcoming
  return { canViewClient: true, reason: 'UPCOMING_ACCEPTED' }
}

/**
 * For list pages: visible client ids for this pro.
 * Same policy as getProClientVisibility, just batched.
 */
export async function getVisibleClientIdSetForPro(proId: string): Promise<Set<string>> {
  const now = new Date()

  const rows = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      OR: visibilityOr(now) as any,
    },
    select: { clientId: true },
    distinct: ['clientId'],
    take: 5000,
  })

  return new Set(rows.map((r) => String(r.clientId)))
}

/**
 * Use this in server pages/routes to hard-gate access.
 * Returns a result so the page can choose redirect vs notFound.
 */
export async function assertProCanViewClient(proId: string, clientId: string) {
  const visibility = await getProClientVisibility(proId, clientId)
  return visibility.canViewClient ? { ok: true as const, visibility } : { ok: false as const, visibility }
}
