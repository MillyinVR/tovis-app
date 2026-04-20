// app/api/me/following/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, requireClient } from '@/app/api/_utils'
import {
  buildMyFollowingListResponse,
  getFollowErrorMeta,
  listFollowingPage,
} from '@/lib/follows'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(req.url)

    const page = await listFollowingPage(prisma, {
    clientId: auth.clientId,
    viewerClientId: auth.clientId,
    take: pickInt(searchParams.get('take')) ?? undefined,
    skip: pickInt(searchParams.get('skip')) ?? undefined,
    })

    return jsonOk(
      buildMyFollowingListResponse({
        clientId: auth.clientId,
        items: page.items,
        pagination: page.pagination,
      }),
      200,
    )
  } catch (error) {
    const followError = getFollowErrorMeta(error)
    if (followError) {
      return jsonFail(followError.status, followError.message, {
        code: followError.code,
      })
    }

    console.error('GET /api/me/following error', error)
    return jsonFail(500, 'Couldn’t load following. Try again.', {
      code: 'INTERNAL',
    })
  }
}