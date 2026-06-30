// app/pro/aftercare/page.tsx
import { redirect } from 'next/navigation'

import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadProAftercareList } from '@/lib/aftercare/loadProAftercareList'

import AftercareListClient from './AftercareListClient'

export const dynamic = 'force-dynamic'

export default async function ProAftercarePage() {
  const auth = await requirePro()

  if (!auth.ok) {
    redirect(`/login?from=${encodeURIComponent('/pro/aftercare')}`)
  }

  // The shared loader runs the query + derivation (also used by GET
  // /api/v1/pro/aftercare) so the page and the API never drift. The
  // appointment's own location timezone wins per row; the pro timezone is the
  // fallback when a row has none.
  const items = await loadProAftercareList({
    professionalId: auth.professionalId,
    professionalTimeZone: auth.user.professionalProfile?.timeZone,
  })

  return <AftercareListClient items={items} />
}
