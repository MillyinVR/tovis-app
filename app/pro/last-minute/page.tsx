// app/pro/last-minute/page.tsx
import { redirect } from 'next/navigation'

import LastMinuteWorkspaceClient from './LastMinuteWorkspaceClient'

import { getCurrentUser } from '@/lib/currentUser'
import { loadLastMinuteWorkspace } from '@/lib/pro/loadLastMinuteWorkspace'

export const dynamic = 'force-dynamic'

export default async function ProLastMinutePage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/last-minute')
  }

  // The shared loader runs the query + payload shaping (also used by GET
  // /api/v1/pro/last-minute), so the page and the API never drift.
  const initial = await loadLastMinuteWorkspace({
    professionalId: user.professionalProfile.id,
    professionalTimeZone: user.professionalProfile.timeZone,
  })

  return (
    <main className="lm-page-shell" aria-label="Last minute openings">
      <LastMinuteWorkspaceClient initial={initial} />
    </main>
  )
}