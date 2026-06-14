// app/api/debug/me/route.ts

import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/app/api/_utils/auth/getOptionalUser'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getOptionalUser()
  return NextResponse.json({
    ok: true,
    user: user
      ? { id: user.id, email: user.email, role: user.role }
      : null,
  })
}
