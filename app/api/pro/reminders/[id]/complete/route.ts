// app/api/pro/reminders/[id]/complete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, pickString, requirePro } from '@/app/api/_utils'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await Promise.resolve(params)
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

    return NextResponse.redirect(new URL('/pro/reminders', req.url))
  } catch (e) {
    console.error('POST /api/pro/reminders/[id]/complete error', e)
    return jsonFail(500, 'Internal server error')
  }
}
