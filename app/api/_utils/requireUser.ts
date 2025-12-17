import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/currentUser'

export async function requireUser() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    return {
      user: null as any,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { user, res: null as any }
}
