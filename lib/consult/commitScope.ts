// lib/consult/commitScope.ts
//
// "May this consult inform the booking this client is committing to right now?"
//
// Extracted from `resolveFinalizeConsultAttribution` in the booking write
// boundary when Book the Look's B4 gained a SECOND commit-time reader of the
// same question: the hold, which must be sized by the consult's proposal before
// any booking exists (`lib/consult/proposalCommit.ts`).
//
// It is one function rather than two because the answer is a permission, and a
// second spelling of a permission is how a new door ends up with none of the
// controls the old one applies ([[a-fork-under-a-new-name-bypasses-its-callers-controls]]).
// The founder gate, the session lock, the ownership predicate and the anchor
// rule all live here once.

import 'server-only'

import { Prisma } from '@prisma/client'

import { isFinalizeConsultAttributionOwned } from '@/lib/booking/consultAttribution'

import { isAiConsultC6ExposureEnabledForPro } from './access'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor } from './anchor'

export const CONSULT_COMMIT_SCOPE_SELECT = {
  id: true,
  status: true,
  ...CONSULT_ANCHOR_SELECT,
} satisfies Prisma.ConsultSessionSelect

export type ConsultCommitScopeSession = Prisma.ConsultSessionGetPayload<{
  select: typeof CONSULT_COMMIT_SCOPE_SELECT
}>

export type ConsultCommitScopeResult =
  | { ok: true; session: ConsultCommitScopeSession }
  /** Ownership, tenant, vertical and founder-gate misses are indistinguishable. */
  | { ok: false; hidden: true }
  /** A real, tellable refusal: the anchor is no longer eligible. */
  | { ok: false; hidden: false }

/**
 * Lock, load, and answer.
 *
 * The session lock is taken FIRST and for the same reason it always was:
 * lifecycle and revocation writers hold it, so a booking is only ever stamped
 * from a coherent completed consult state, never from a stale pre-revocation
 * read.
 */
export async function resolveConsultCommitScope(
  tx: Prisma.TransactionClient,
  args: {
    consultId: string
    clientId: string
    professionalId: string
    serviceCategoryId: string | null
    now: Date
  },
): Promise<ConsultCommitScopeResult> {
  // C6 is intentionally darker than C1-C5. A founder-gated consult is still
  // hidden until the explicit live-evaluation ship gate is checked in.
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    return { ok: false, hidden: true }
  }

  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ConsultSession"
    WHERE "id" = ${args.consultId}
    FOR UPDATE
  `)

  const consult = await tx.consultSession.findUnique({
    where: { id: args.consultId },
    select: CONSULT_COMMIT_SCOPE_SELECT,
  })

  if (
    !consult ||
    !isFinalizeConsultAttributionOwned({
      candidate: consult,
      clientId: args.clientId,
      professionalId: args.professionalId,
      serviceCategoryId: args.serviceCategoryId,
    })
  ) {
    return { ok: false, hidden: true }
  }

  // A consult informing a new booking may itself be anchored to a booking or,
  // since Book the Look (B2), to a look — evaluateConsultAnchor answers both
  // without this call site knowing which.
  const anchor = evaluateConsultAnchor(consult, args.now)
  if (!anchor.eligible) {
    return { ok: false, hidden: anchor.hidden }
  }

  return { ok: true, session: consult }
}
