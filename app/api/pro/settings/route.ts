// app/api/pro/settings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s : undefined
}

function isValidIanaTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json(
        {
          error: 'Only professionals can update settings.',
          debug: {
            hasUser: Boolean(user),
            role: (user as any)?.role ?? null,
            hasProfessionalProfile: Boolean((user as any)?.professionalProfile?.id),
          },
        },
        { status: 401 },
      )
    }

    const body = await req.json().catch(() => ({} as any))

    const autoAcceptBookings = pickBoolean(body?.autoAcceptBookings)

    // If timeZone is present but empty, treat as invalid (don’t allow clearing to "")
    const timeZoneRaw = body?.timeZone
    const timeZoneCandidate =
      timeZoneRaw === undefined ? undefined : pickNonEmptyString(timeZoneRaw)

    if (timeZoneRaw !== undefined && timeZoneCandidate === undefined) {
      return NextResponse.json(
        { error: 'Invalid timeZone (must be a non-empty IANA timezone string).' },
        { status: 400 },
      )
    }

    const timeZone =
      timeZoneCandidate && isValidIanaTimeZone(timeZoneCandidate)
        ? timeZoneCandidate
        : undefined

    if (timeZoneCandidate !== undefined && timeZone === undefined) {
      return NextResponse.json(
        { error: 'Invalid timeZone (must be a valid IANA timezone, e.g. "America/New_York").' },
        { status: 400 },
      )
    }

    // Must change *something*
    if (autoAcceptBookings === undefined && timeZone === undefined) {
      return NextResponse.json(
        { error: 'Nothing to update. Provide autoAcceptBookings (boolean) and/or timeZone (IANA string).' },
        { status: 400 },
      )
    }

    const professionalProfile = await prisma.professionalProfile.update({
      where: { id: (user as any).professionalProfile.id },
      data: {
        ...(autoAcceptBookings !== undefined ? { autoAcceptBookings } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}),
      },
      select: {
        id: true,
        autoAcceptBookings: true,
        timeZone: true,
      },
    })

    return NextResponse.json({ ok: true, professionalProfile }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/settings error:', e)
    return NextResponse.json({ error: 'Failed to update settings.' }, { status: 500 })
  }
}
