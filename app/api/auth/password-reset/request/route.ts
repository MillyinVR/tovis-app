// app/api/auth/password-reset/request/route.ts
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { jsonOk, normalizeEmail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Body = { email?: unknown }

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function getAppUrlFromRequest(req: Request): string | null {
  // Prefer env for canonical URL
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/+$/, '')

  // Fallback: infer from request headers (works in Next route handlers)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  if (!host) return null

  return `${proto}://${host}`.replace(/\/+$/, '')
}

function getRequestIp(req: Request): string | null {
  // x-forwarded-for can be a comma-separated list; first is original client
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    return first || null
  }
  return null
}

async function sendPasswordResetEmail(args: { to: string; resetUrl: string }) {
  // TODO: wire to your email provider (Resend/Postmark/SES/etc).
  // Keep this function as the single integration point.
  console.log('[password-reset] send email to:', args.to, 'url:', args.resetUrl)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const email = normalizeEmail(body.email)

    // Always return OK (no enumeration)
    if (!email) return jsonOk({ ok: true }, 200)

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    })

    // Still return OK even if not found
    if (!user) return jsonOk({ ok: true }, 200)

    const appUrl = getAppUrlFromRequest(req)
    if (!appUrl) {
      // Server misconfig; return OK for privacy, but log for debugging
      console.error('[password-reset] missing app URL (NEXT_PUBLIC_APP_URL or Host headers)')
      return jsonOk({ ok: true }, 200)
    }

    // Create one-time token (store only hash)
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = sha256(token)

    // Invalidate older unused tokens for this user (optional but nice)
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    const expiresAt = new Date(Date.now() + 1000 * 60 * 30) // 30 minutes

    const ip = getRequestIp(req)
    const userAgent = req.headers.get('user-agent') || null

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt, ip, userAgent },
      select: { id: true },
    })

    const resetUrl = `${appUrl}/reset-password/${token}`

    await sendPasswordResetEmail({ to: user.email, resetUrl })

    return jsonOk({ ok: true }, 200)
  } catch (err) {
    console.error('Password reset request error', err)
    // Still return OK to avoid leaking failure states to attackers
    return jsonOk({ ok: true }, 200)
  }
}
