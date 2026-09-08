import { FounderMessageReportReason, Prisma } from '@prisma/client'

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import type { FounderMessageReportCreateResponseDTO } from '@/lib/dto/founders'
import { canAccessFounderRoom, resolveFounderPortalAccess } from '@/lib/founders/access'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function reportReason(value: unknown): FounderMessageReportReason | null {
  if (typeof value !== 'string') return null
  return Object.values(FounderMessageReportReason).find((item) => item === value) ?? null
}

export async function POST(
  req: Request,
  ctx: RouteContext<{ messageId: string }>,
) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const { messageId } = await resolveRouteParams(ctx)
    const message = await prisma.founderMessage.findUnique({
      where: { id: messageId },
      select: { id: true, room: true, senderUserId: true, hiddenAt: true },
    })
    if (!message || message.hiddenAt) return jsonFail(404, 'Message not found.')

    const access = await resolveFounderPortalAccess(auth.user)
    if (!canAccessFounderRoom(access, message.room)) return jsonFail(403, 'Forbidden.')
    if (message.senderUserId === auth.user.id) {
      return jsonFail(400, 'You cannot report your own message.')
    }

    const input = await readJsonRecord(req)
    const reason = reportReason(input.reason)
    const details = pickString(input.details)?.trim() || null
    if (!reason) return jsonFail(400, 'Choose a report reason.')
    if (details && details.length > 1000) return jsonFail(400, 'Report details are too long.')

    const report = await prisma.founderMessageReport.create({
      data: { messageId, reporterUserId: auth.user.id, reason, details },
      select: { id: true },
    })
    return jsonOk({ reportId: report.id } satisfies FounderMessageReportCreateResponseDTO, 201)
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonFail(409, 'You already reported this message.')
    }
    console.error('POST /api/v1/founders/messages/[messageId]/report', error)
    return jsonFail(500, 'Could not submit this report.')
  }
}
