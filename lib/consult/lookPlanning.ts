import type { Prisma } from '@prisma/client'
import { readOptionalEnv } from '@/lib/env'

/** Batched rollout switch; historical plans retain their saved interpretation. */
export function consultLookPlanningEnabled(): boolean {
  return readOptionalEnv('AI_CONSULT_LOOK_PLANS_ENABLED') === 'true'
}


/** Minimum honest intake for a first draft, not a completed safety history. */
export function hasConsultLookPlanMinimumIntake(payload: {
  packId: string; packVersion: number; answers: Readonly<Record<string, string>>
}): boolean {
  return ((payload.packId === 'hair-color' && payload.packVersion === 4) ||
    (payload.packId === 'hair-general' && payload.packVersion === 3)) &&
    ['low', 'medium', 'high'].includes(payload.answers.maintenance_tolerance ?? '')
}

/** Once a version exists, switching off new analysis must not restore the reference-service shortcut. */
export async function consultRequiresLookChoice(db: Prisma.TransactionClient, consultSessionId: string): Promise<boolean> {
  const version = await db.consultLookBriefVersion.findFirst({ where: { consultSessionId }, select: { id: true } })
  if (version) return true
  if (!consultLookPlanningEnabled()) return false
  const session = await db.consultSession.findUnique({ where: { id: consultSessionId },
    select: { serviceCategory: { select: { consultFamily: true } } } })
  return session?.serviceCategory.consultFamily === 'HAIR'
}
