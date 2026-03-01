// app/(main)/booking/add-ons/page.tsx
import { Suspense } from 'react'
import { headers } from 'next/headers'
import AddOnsClient from './ui/AddOnsClient'

export const dynamic = 'force-dynamic'

type ServiceLocationType = 'SALON' | 'MOBILE'
type BookingSource = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type AddOnDTO = {
  id: string // OfferingAddOn.id ✅
  serviceId: string
  title: string
  group: string | null
  price: string // "25.00"
  minutes: number
  sortOrder: number
  isRecommended: boolean
}

// ✅ Discriminated union aligned with jsonOk/jsonFail outputs
type AddOnsApiOk = {
  ok: true
  addOns?: AddOnDTO[]
  offeringId?: string
  locationType?: ServiceLocationType
}

type AddOnsApiFail = {
  ok: false
  error: string
}

type AddOnsApiResponse = AddOnsApiOk | AddOnsApiFail

type AddOnsDTOResult = { ok: true; addOns: AddOnDTO[] } | { ok: false; error: string }

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function pickOne(v: string | string[] | undefined | null) {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function cleanString(v: string | null) {
  const s = (v || '').trim()
  return s ? s : null
}

function normalizeLocationType(v: string | null): ServiceLocationType {
  const s = (v || '').trim().toUpperCase()
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function normalizeSource(v: string | null): BookingSource {
  const s = (v || '').trim().toUpperCase()
  if (s === 'DISCOVERY') return 'DISCOVERY'
  if (s === 'AFTERCARE') return 'AFTERCARE'
  return 'REQUESTED'
}

async function getRequestOrigin() {
  // In your Next version, headers() is async
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) return null
  return `${proto}://${host}`
}

function parseAddOnsApiResponse(x: unknown): AddOnsApiResponse | null {
  if (!isRecord(x)) return null
  const ok = x.ok
  if (ok === true) {
    const addOnsRaw = x.addOns
    return {
      ok: true,
      offeringId: typeof x.offeringId === 'string' ? x.offeringId : undefined,
      locationType: x.locationType === 'MOBILE' || x.locationType === 'SALON' ? x.locationType : undefined,
      addOns: Array.isArray(addOnsRaw) ? (addOnsRaw as AddOnDTO[]) : undefined,
    }
  }
  if (ok === false) {
    const error = typeof x.error === 'string' ? x.error.trim() : ''
    if (!error) return null
    return { ok: false, error }
  }
  return null
}

async function safeJson(res: Response): Promise<AddOnsApiResponse | null> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return null
  try {
    const parsed: unknown = await res.json()
    return parseAddOnsApiResponse(parsed)
  } catch {
    return null
  }
}

async function fetchAddOns(args: { offeringId: string; locationType: ServiceLocationType }): Promise<AddOnsDTOResult> {
  const qs = new URLSearchParams({ offeringId: args.offeringId, locationType: args.locationType })

  const origin = await getRequestOrigin()
  const url = origin ? `${origin}/api/offerings/add-ons?${qs.toString()}` : `/api/offerings/add-ons?${qs.toString()}`

  let res: Response
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
  } catch (err: unknown) {
    console.error('fetchAddOns network error:', err)
    return { ok: false, error: 'Network error loading add-ons.' }
  }

  const body = await safeJson(res)

  // Non-2xx or malformed JSON
  if (!res.ok) {
    if (body && body.ok === false) return { ok: false, error: body.error }
    return { ok: false, error: `Failed to load add-ons (${res.status}).` }
  }

  // 2xx but still not an ok:true payload (shouldn’t happen, but don’t trust it blindly)
  if (!body || body.ok !== true) {
    return { ok: false, error: 'Failed to load add-ons.' }
  }

  const addOns = Array.isArray(body.addOns) ? body.addOns : []
  return { ok: true, addOns }
}

export default async function BookingAddOnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const holdId = cleanString(pickOne(sp.holdId) ?? null)
  const offeringId = cleanString(pickOne(sp.offeringId) ?? null)
  const locationType = normalizeLocationType(cleanString(pickOne(sp.locationType) ?? null))
  const source = normalizeSource(cleanString(pickOne(sp.source) ?? null))
  const mediaId = cleanString(pickOne(sp.mediaId) ?? null)

  let addOns: AddOnDTO[] = []
  let initialError: string | null = null

  if (!offeringId) {
    initialError = 'Missing offering. Please go back and pick a time again.'
  } else {
    const res = await fetchAddOns({ offeringId, locationType })
    if (!res.ok) initialError = res.error
    else addOns = res.addOns
  }

  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-180 px-4 pb-24 pt-10 text-textPrimary">
          <div className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold text-textSecondary">
            Loading add-ons…
          </div>
        </main>
      }
    >
      <AddOnsClient
        holdId={holdId}
        offeringId={offeringId}
        locationType={locationType}
        source={source}
        mediaId={mediaId}
        addOns={addOns}
        initialError={initialError}
      />
    </Suspense>
  )
}