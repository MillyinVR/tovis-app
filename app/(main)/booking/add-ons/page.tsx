import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import AddOnsClient from './ui/AddOnsClient'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function pickOne(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

function normalizeLocationType(v: string | undefined) {
  const s = (v || '').trim().toUpperCase()
  if (s === 'SALON') return 'SALON' as const
  if (s === 'MOBILE') return 'MOBILE' as const
  return null
}

function normalizeSource(v: string | undefined) {
  const s = (v || '').trim().toUpperCase()
  if (s === 'REQUESTED') return 'REQUESTED' as const
  if (s === 'DISCOVERY') return 'DISCOVERY' as const
  if (s === 'AFTERCARE') return 'AFTERCARE' as const
  return null
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

export default async function AddOnsPage({ searchParams }: Props) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect(`/login?from=${encodeURIComponent('/booking/add-ons')}`)

  const sp = await searchParams

  const holdId = pickOne(sp.holdId)
  const offeringId = pickOne(sp.offeringId)
  const locationTypeRaw = pickOne(sp.locationType)
  const sourceRaw = pickOne(sp.source)
  const mediaId = pickOne(sp.mediaId) ?? null

  const locationType = normalizeLocationType(locationTypeRaw)
  const source = normalizeSource(sourceRaw)

  if (!holdId || !offeringId || !locationType || !source) redirect('/looks')
  if (source === 'DISCOVERY' && !mediaId) redirect('/looks')

  // ✅ Step 4: fetch real add-ons from DB
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/offerings/add-ons?offeringId=${encodeURIComponent(
      offeringId,
    )}&locationType=${encodeURIComponent(locationType)}`,
    { cache: 'no-store' },
  )

  const data = await safeJson(res)
  const addOns = Array.isArray(data?.addOns) ? data.addOns : []

  return (
    <AddOnsClient
      holdId={holdId}
      offeringId={offeringId}
      locationType={locationType}
      source={source}
      mediaId={mediaId}
      addOns={addOns}
    />
  )
}
