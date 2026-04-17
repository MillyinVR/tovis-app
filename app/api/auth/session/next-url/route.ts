// app/api/auth/session/next-url/route.ts
import { Prisma } from '@prisma/client'

import { jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function safeNextUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function nextUrlFromPayloadJson(payloadJson: Prisma.JsonValue): string | null {
  if (!isRecord(payloadJson)) return null
  return safeNextUrl(payloadJson.nextUrl)
}

export async function GET() {
  const auth = await requireUser({ allowVerificationSession: true })
  if (!auth.ok) return auth.res

  const now = new Date()

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: {
      tapIntents: {
        where: {
          expiresAt: { gt: now },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
        select: {
          payloadJson: true,
        },
      },
    },
  })

  if (!user) {
    return jsonOk({ nextUrl: null })
  }

  const payloadNext = user.tapIntents[0]
    ? nextUrlFromPayloadJson(user.tapIntents[0].payloadJson)
    : null

  return jsonOk({ nextUrl: payloadNext })
}