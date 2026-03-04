// app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  const COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.tovis.app' : undefined

res.cookies.set('tovis_token', '', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 0,
  ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
})
  return res
}
