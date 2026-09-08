import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { resolveFounderPortalAccess } from '@/lib/founders/access'
import { founderPortalDTO } from '@/lib/founders/portal'

import FoundersPortalClient from './FoundersPortalClient'

export const dynamic = 'force-dynamic'

export default async function FoundersPortalPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/founders')

  const access = await resolveFounderPortalAccess(user)
  if (!access.canAccess) redirect('/')

  const portal = await founderPortalDTO(user.id, access)
  return <FoundersPortalClient initialPortal={portal} currentUserId={user.id} />
}
