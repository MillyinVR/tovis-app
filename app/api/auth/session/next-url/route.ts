// app/api/auth/session/next-url/route.ts
import { jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { prisma } from '@/lib/prisma'
import { nextUrlFromPayloadJson } from '@/lib/security/safeNextUrl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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