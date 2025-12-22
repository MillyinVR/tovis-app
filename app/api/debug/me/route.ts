import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  return NextResponse.json({
    ok: true,
    user: user
      ? { id: user.id, email: user.email, role: user.role }
      : null,
  })
}
