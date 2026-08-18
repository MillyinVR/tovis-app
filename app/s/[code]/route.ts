// app/s/[code]/route.ts
//
// Public short-link resolver. Tapped from an SMS/email link — never a page a
// human types by hand — so every failure (bad format, unknown code, expired,
// rate-limited) collapses to a flat response with no distinguishing detail:
// this can't be used as an oracle for which codes exist.
//
// 301, unlike the rest of this app's redirect routes (which use 302/303/307
// for ephemeral or post-mutation redirects — see
// app/api/v1/auth/session-handoff/[token]/route.ts). A short link's
// destination is fixed for the life of the code, so a permanent redirect is
// the correct HTTP semantic. Cache-Control: no-store rides along anyway, so a
// browser that would otherwise skip re-requesting a cached 301 still hits
// this route (and gets counted) on a second tap from the same device.

import { NextResponse } from 'next/server'

import { getAppUrlFromRequest } from '@/lib/appUrl'
import { prisma } from '@/lib/prisma'
import { sanitizeShortLinkDestinationPath } from '@/lib/shortLink/allowlist'
import { normalizeShortLinkCode } from '@/lib/shortLink/generateCode'
import { isShortLinkResolveWithinRateLimit } from '@/lib/shortLink/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function notFoundResponse(): NextResponse {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function rateLimitedResponse(): NextResponse {
  return new NextResponse('Too many requests', {
    status: 429,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(
  request: Request,
  props: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  if (!(await isShortLinkResolveWithinRateLimit(request))) {
    return rateLimitedResponse()
  }

  const { code } = await props.params
  const normalized = normalizeShortLinkCode(code)
  if (!normalized) return notFoundResponse()

  const link = await prisma.shortLink.findUnique({
    where: { code: normalized },
    select: { id: true, destinationPath: true, expiresAt: true },
  })
  if (!link) return notFoundResponse()

  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return notFoundResponse()
  }

  // Re-validate at resolution, independent of the allowlist check that ran at
  // creation — defense in depth (the re-check-at-redemption pattern in
  // lib/auth/sessionHandoff.ts) so a row written by any future code path
  // still can't become an open redirect.
  const destinationPath = sanitizeShortLinkDestinationPath(link.destinationPath)
  if (!destinationPath) return notFoundResponse()

  // Best-effort click log — a write failure here must never block the
  // redirect the client is waiting on.
  await prisma.shortLink
    .update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 }, lastClickedAt: new Date() },
    })
    .catch((error: unknown) => {
      console.error('short-link click log failed', {
        code: normalized,
        error,
      })
    })

  const base = getAppUrlFromRequest(request) ?? request.url
  const target = new URL(destinationPath, base)

  const res = NextResponse.redirect(target, 301)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
