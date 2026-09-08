import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { resolveFounderPortalAccess } from '@/lib/founders/access'
import { founderAdminSummary } from '@/lib/founders/admin'

import FounderAdminClient from './FounderAdminClient'

export const dynamic = 'force-dynamic'

export default async function FounderAdminPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/founders/admin')
  const access = await resolveFounderPortalAccess(user)
  if (!access.canAdminister) redirect('/founders')

  return (
    <main className="founder-admin-shell">
      <Link href="/founders" className="founder-admin-back">← Back to all conversations</Link>
      <FounderAdminClient initialSummary={await founderAdminSummary()} />
    </main>
  )
}
