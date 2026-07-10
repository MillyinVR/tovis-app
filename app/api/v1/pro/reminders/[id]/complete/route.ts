// app/api/v1/pro/reminders/[id]/complete/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const id = pickString(rawId)
    if (!id) return jsonFail(400, 'Missing reminder id.')

    const reminder = await prisma.reminder.findUnique({
      where: { id },
      select: { id: true, professionalId: true },
    })

    if (!reminder || reminder.professionalId !== professionalId) {
      return jsonFail(404, 'Not found')
    }

    await prisma.reminder.update({
      where: { id },
      data: { completedAt: new Date() },
    })

    // Mirror the sibling create route: browsers submit an HTML form and want the
    // page back, so redirect them (explicit 303 → the follow-up is a GET; the
    // NextResponse.redirect default of 307 would re-POST to the page route and
    // 405). API / native callers (Accept: application/json) get the completed id.
    const accept = req.headers.get('accept') || ''
    if (accept.includes('text/html')) {
      return Response.redirect(new URL('/pro/reminders', req.url), 303)
    }

    return jsonOk({ id: reminder.id }, 200)
  } catch (e) {
    console.error('POST /api/v1/pro/reminders/[id]/complete error', e)
    return jsonFail(500, 'Internal server error')
  }
}
