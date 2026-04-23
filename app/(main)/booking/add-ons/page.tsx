// app/(main)/booking/add-ons/page.tsx
import { headers } from 'next/headers'
import AddOnsClient from './ui/AddOnsClient'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'

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

function parseCommaIds(raw: string | null, max: number): string[] {
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()

  for (const part of raw.split(',')) {
    const s = part.trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= max) break
  }

  return out
}

async function getRequestOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) return null
  return `${proto}://${host}`
}

function coerceAddOn(x: unknown): AddOnDTO | null {
  if (!isRecord(x)) return null

  const id = typeof x.id === 'string' ? x.id.trim() : ''
  const serviceId = typeof x.serviceId === 'string' ? x.serviceId.trim() : ''
  const title = typeof x.title === 'string' ? x.title.trim() : ''
  const price = typeof x.price === 'string' ? x.price.trim() : ''
  const minutes = typeof x.minutes === 'number' ? x.minutes : null
  const sortOrder = typeof x.sortOrder === 'number' ? x.sortOrder : null
  const isRecommended = typeof x.isRecommended === 'boolean' ? x.isRecommended : false
  const group = typeof x.group === 'string' ? x.group : x.group == null ? null : null

  if (!id || !serviceId || !title || !price) return null
  if (minutes == null || !Number.isFinite(minutes)) return null
  if (sortOrder == null || !Number.isFinite(sortOrder)) return null

  return { id, serviceId, title, group, price, minutes, sortOrder, isRecommended }
}

function parseAddOnsApiResponse(x: unknown): AddOnsApiResponse | null {
  if (!isRecord(x)) return null

  const ok = x.ok
  if (ok === true) {
    const addOnsRaw = x.addOns
    const addOns = Array.isArray(addOnsRaw) ? (addOnsRaw.map(coerceAddOn).filter(Boolean) as AddOnDTO[]) : undefined

    const offeringId = typeof x.offeringId === 'string' ? x.offeringId : undefined
    const locationType = x.locationType === 'MOBILE' || x.locationType === 'SALON' ? x.locationType : undefined

    return { ok: true, offeringId, locationType, addOns }
  }

  if (ok === false) {
    const error = typeof x.error === 'string' ? x.error.trim() : ''
    if (!error) return null
    return { ok: false, error }
  }

  return null
}

async function fetchAddOns(args: { offeringId: string; locationType: ServiceLocationType }): Promise<AddOnsDTOResult> {
  const qs = new URLSearchParams({ offeringId: args.offeringId, locationType: args.locationType })

  const origin = await getRequestOrigin()
  const url = origin ? `${origin}/api/offerings/add-ons?${qs.toString()}` : `/api/offerings/add-ons?${qs.toString()}`

  const h = await headers()
  const cookie = h.get('cookie') ?? ''

  let res: Response
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { cookie } : {}),
      },
    })
  } catch (err: unknown) {
    console.error('fetchAddOns network error:', err)
    return { ok: false, error: 'Network error loading add-ons.' }
  }

  const body = await safeJsonRecord(res)
  const parsed = parseAddOnsApiResponse(body)

  if (!res.ok) {
    if (parsed && parsed.ok === false) return { ok: false, error: parsed.error }
    return { ok: false, error: readErrorMessage(body) ?? `Failed to load add-ons (${res.status}).` }
  }

  if (!parsed || parsed.ok !== true) {
    return { ok: false, error: readErrorMessage(body) ?? 'Failed to load add-ons.' }
  }

  return { ok: true, addOns: parsed.addOns ?? [] }
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
  const lookPostId = cleanString(pickOne(sp.lookPostId) ?? null)

  const urlAddOnIdsRaw = cleanString(pickOne(sp.addOnIds) ?? null)
  const urlAddOnIds = parseCommaIds(urlAddOnIdsRaw, 50)

  let addOns: AddOnDTO[] = []
  let initialError: string | null = null

  if (!offeringId) {
    initialError = 'Missing offering. Please go back and pick a time again.'
  } else {
    const res = await fetchAddOns({ offeringId, locationType })
    if (!res.ok) initialError = res.error
    else addOns = res.addOns
  }

  // ✅ server-hydrate initial selection (prevents client flicker)
  const initialSelectedIds = (() => {
    if (!addOns.length) return []

    const allowed = new Set(addOns.map((a) => a.id))
    const filteredFromUrl = urlAddOnIds.filter((id) => allowed.has(id))

    if (filteredFromUrl.length) return filteredFromUrl

    // If URL has nothing valid, fall back to recommended defaults
    const recommended = addOns.filter((a) => a.isRecommended).map((a) => a.id)
    return recommended
  })()

  return (
    <AddOnsClient
      holdId={holdId}
      offeringId={offeringId}
      locationType={locationType}
      source={source}
      mediaId={mediaId}
      lookPostId={lookPostId}
      addOns={addOns}
      initialError={initialError}
      initialSelectedIds={initialSelectedIds}
    />
  )
}