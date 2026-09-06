// app/api/v1/client/consult/[id]/thread/route.ts
//
// P5a — the consult thread in ONE read ("the consult is a chat", handoff Part 2).
//
// Read-only and idempotent, so it is a GET. It serves the same flow state the
// per-stage endpoints serve, ordered, plus `nextOpenMessageId` — which is what
// makes "reopening a consult resumes at the next open step" a read rather than
// a rule each client re-derives from four progress blockers.
//
// The per-stage endpoints are UNCHANGED and remain the only way to answer
// anything. This route adds no state and no writes of its own.
//
// Refusals are deliberately uniform with the rest of the consult surface: a
// consult that is not yours is indistinguishable from one that does not exist.

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { isAiConsultEnabledForPro } from '@/lib/consult/access'
import {
  ConsultThreadNotFoundError,
  loadConsultThread,
} from '@/lib/consult/thread'
import type { ConsultThreadResponseDTO } from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'
import { resolveTenantContextForRequest } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id } = await resolveRouteParams(ctx)
    if (!id) return jsonFail(404, 'Not found.')

    // The founder gate is re-checked on every read, the same as the by-id
    // lookup: toggling the pilot off must darken reads of already-created
    // sessions, not just the creation of new ones.
    const session = await prisma.consultSession.findUnique({
      where: { id },
      select: { clientId: true, professionalId: true },
    })
    if (
      !session ||
      session.clientId !== auth.clientId ||
      !isAiConsultEnabledForPro(session.professionalId)
    ) {
      return jsonFail(404, 'Not found.')
    }

    const brand = getBrandForTenantContext(
      await resolveTenantContextForRequest(request),
    )

    const thread = await loadConsultThread({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
      copy: brand.clientConsultThread,
      captureCopy: brand.clientConsultCapture,
      inspirationCopy: brand.clientConsultInspiration,
      planDiffCopy: brand.clientConsultPlanDiff,
    })

    return jsonOk<ConsultThreadResponseDTO>({ thread })
  } catch (e: unknown) {
    if (e instanceof ConsultThreadNotFoundError) {
      return jsonFail(404, 'Not found.')
    }
    console.error('GET /api/v1/client/consult/[id]/thread error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}
