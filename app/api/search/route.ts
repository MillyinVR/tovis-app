// app/api/search/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { Prisma, type ProfessionType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickNumber(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseBool(v: string | null) {
  const s = (v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

type Sort = 'DISTANCE' | 'RATING' | 'PRICE' | 'NAME'
function normalizeSort(v: string | null): Sort {
  const s = (v ?? '').trim().toUpperCase()
  if (s === 'RATING') return 'RATING'
  if (s === 'PRICE') return 'PRICE'
  if (s === 'NAME') return 'NAME'
  return 'DISTANCE'
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function toNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v))
  return Number.isFinite(n) ? n : null
}

function decToNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (v instanceof Prisma.Decimal) return v.toNumber()
  return null
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.7613
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)
  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return R * c
}

function milesToLatDelta(miles: number) {
  return miles / 69.0
}
function milesToLngDelta(miles: number, lat: number) {
  const denom = Math.cos((lat * Math.PI) / 180)
  if (!Number.isFinite(denom) || denom === 0) return miles / 69.0
  return miles / (69.0 * denom)
}

function normalizeQuery(q: string) {
  return q.trim().toLowerCase()
}

function inferProfessionTypes(q: string): ProfessionType[] {
  const s = normalizeQuery(q)
  const hits: ProfessionType[] = []
  if (s.includes('barber')) hits.push('BARBER')
  if (s.includes('cosmo') || s.includes('hair') || s.includes('stylist')) hits.push('COSMETOLOGIST')
  if (s.includes('esthetic') || s.includes('facial') || s.includes('skin')) hits.push('ESTHETICIAN')
  if (s.includes('nail') || s.includes('mani') || s.includes('pedi')) hits.push('MANICURIST')
  if (s.includes('massage')) hits.push('MASSAGE_THERAPIST')
  if (s.includes('makeup') || s.includes('mua')) hits.push('MAKEUP_ARTIST')
  return Array.from(new Set(hits))
}

// ---- open-now helpers (location working hours) ----
type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
type DayHours = { enabled: boolean; start: string; end: string }
type WorkingHours = Partial<Record<WeekdayKey, DayHours>>

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function parseHHMM(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

function parseWorkingHours(raw: unknown): WorkingHours | null {
  if (!isRecord(raw)) return null
  const out: WorkingHours = {}
  const keys: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  for (const k of keys) {
    const v = raw[k]
    if (!isRecord(v)) continue
    const enabled = v.enabled === true
    const start = typeof v.start === 'string' ? v.start : null
    const end = typeof v.end === 'string' ? v.end : null
    if (!start || !end) continue
    out[k] = { enabled, start, end }
  }
  return out
}

function localNowKeyAndMinutes(timeZone: string): { day: WeekdayKey; minutes: number } | null {
  const tz = timeZone?.trim()
  if (!tz) return null

  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)

  const wd = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase() ?? ''
  const hour = parts.find((p) => p.type === 'hour')?.value
  const min = parts.find((p) => p.type === 'minute')?.value
  const hh = hour ? Number(hour) : NaN
  const mm = min ? Number(min) : NaN
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null

  const day: WeekdayKey =
    wd.startsWith('mon') ? 'mon' :
    wd.startsWith('tue') ? 'tue' :
    wd.startsWith('wed') ? 'wed' :
    wd.startsWith('thu') ? 'thu' :
    wd.startsWith('fri') ? 'fri' :
    wd.startsWith('sat') ? 'sat' :
    'sun'

  return { day, minutes: hh * 60 + mm }
}

function isOpenNow(args: { timeZone: string | null; workingHours: unknown }) {
  const tz = args.timeZone?.trim() ?? ''
  if (!tz) return false
  const wh = parseWorkingHours(args.workingHours)
  if (!wh) return false

  const now = localNowKeyAndMinutes(tz)
  if (!now) return false

  const day = wh[now.day]
  if (!day || day.enabled !== true) return false

  const start = parseHHMM(day.start)
  const end = parseHHMM(day.end)
  if (start == null || end == null) return false

  // simple same-day window (if you ever support overnight shifts, we’ll handle that later)
  return now.minutes >= start && now.minutes <= end
}

// ---- response location shape ----
type LocationDTO = {
  id: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
  workingHours: unknown
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const q = (pickString(searchParams.get('q')) ?? '').trim()
    const tabRaw = (pickString(searchParams.get('tab')) ?? 'PROS').toUpperCase()
    const tab = tabRaw === 'SERVICES' ? 'SERVICES' : 'PROS'

    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))

    const radiusMiles = (() => {
      const r = pickNumber(searchParams.get('radiusMiles')) ?? 15
      return clampInt(r, 1, 100)
    })()

    // --- new filters ---
    const mobileOnly = parseBool(searchParams.get('mobile'))
    const openNowOnly = parseBool(searchParams.get('openNow'))
    const minRating = pickNumber(searchParams.get('minRating'))
    const maxPrice = pickNumber(searchParams.get('maxPrice'))
    const sort = normalizeSort(searchParams.get('sort'))

    // --- services ---
    if (tab === 'SERVICES') {
      const services = await prisma.service.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { category: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : undefined,
        take: 40,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, category: { select: { name: true } } },
      })

      return jsonOk({
        ok: true,
        pros: [],
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          categoryName: s.category?.name ?? null,
        })),
      })
    }

    // --- pros ---
    const geoEnabled = lat != null && lng != null
    const origin = geoEnabled ? { lat: lat!, lng: lng! } : null

    const latDelta = geoEnabled ? milesToLatDelta(radiusMiles) : null
    const lngDelta = geoEnabled ? milesToLngDelta(radiusMiles, lat!) : null

    const matchedProfessions = q ? inferProfessionTypes(q) : []

    const pros = await prisma.professionalProfile.findMany({
      where: {
        verificationStatus: 'APPROVED',
        ...(q
          ? {
              OR: [
                { businessName: { contains: q, mode: 'insensitive' } },
                { handle: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },
                ...(matchedProfessions.length ? [{ professionType: { in: matchedProfessions } }] : []),
              ],
            }
          : {}),
      },
      take: 200,
      orderBy: [{ businessName: 'asc' }, { handleNormalized: 'asc' }],
      select: {
        id: true,
        businessName: true,
        handle: true,
        professionType: true,
        avatarUrl: true,
        location: true,

        // all bookable locations w/ coords
        locations: {
          where: { isBookable: true, lat: { not: null }, lng: { not: null } },
          take: 25,
          select: {
            id: true,
            formattedAddress: true,
            city: true,
            state: true,
            timeZone: true,
            placeId: true,
            lat: true,
            lng: true,
            isPrimary: true,
            workingHours: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    })

    const proIds = pros.map((p) => p.id)

    // rating aggregates (for top-rated filter/sort)
    const ratingRows = await prisma.review.groupBy({
      by: ['professionalId'],
      where: { professionalId: { in: proIds } },
      _avg: { rating: true },
      _count: { _all: true },
    })

    const ratingByPro = new Map<string, { avg: number | null; count: number }>()
    for (const r of ratingRows) {
      ratingByPro.set(r.professionalId, {
        avg: typeof r._avg.rating === 'number' ? r._avg.rating : null,
        count: r._count._all ?? 0,
      })
    }

    // offering aggregates (for mobile + under-$ filters/sort)
    const offeringRows = await prisma.professionalServiceOffering.findMany({
      where: { professionalId: { in: proIds }, isActive: true },
      select: {
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
      },
    })

    const offerByPro = new Map<
      string,
      { supportsSalon: boolean; supportsMobile: boolean; minSalon: number | null; minMobile: number | null; minAny: number | null }
    >()

    for (const o of offeringRows) {
      const cur = offerByPro.get(o.professionalId) ?? {
        supportsSalon: false,
        supportsMobile: false,
        minSalon: null,
        minMobile: null,
        minAny: null,
      }

      const sp = decToNum(o.salonPriceStartingAt)
      const mp = decToNum(o.mobilePriceStartingAt)

      if (o.offersInSalon) cur.supportsSalon = true
      if (o.offersMobile) cur.supportsMobile = true

      if (o.offersInSalon && sp != null) cur.minSalon = cur.minSalon == null ? sp : Math.min(cur.minSalon, sp)
      if (o.offersMobile && mp != null) cur.minMobile = cur.minMobile == null ? mp : Math.min(cur.minMobile, mp)

      const candidates = [cur.minSalon, cur.minMobile].filter((x): x is number => typeof x === 'number')
      cur.minAny = candidates.length ? Math.min(...candidates) : null

      offerByPro.set(o.professionalId, cur)
    }

    const mapLocation = (l: (typeof pros)[number]['locations'][number]): LocationDTO => ({
      id: l.id,
      formattedAddress: l.formattedAddress ?? null,
      city: l.city ?? null,
      state: l.state ?? null,
      timeZone: l.timeZone ?? null,
      placeId: l.placeId ?? null,
      lat: toNum(l.lat),
      lng: toNum(l.lng),
      isPrimary: Boolean(l.isPrimary),
      workingHours: l.workingHours,
    })

    // build results (distance or no distance)
    const base = pros.map((p) => {
      const locs = (p.locations ?? []).map(mapLocation).filter((l) => l.lat != null && l.lng != null)
      const primary = locs.find((x) => x.isPrimary) ?? null
      const fallback = primary ?? locs[0] ?? null

      const rating = ratingByPro.get(p.id) ?? { avg: null, count: 0 }
      const offers = offerByPro.get(p.id) ?? { supportsSalon: false, supportsMobile: false, minSalon: null, minMobile: null, minAny: null }

      return {
        p,
        locs,
        primary,
        fallback,
        rating,
        offers,
      }
    })

    // if geo enabled, compute closest location by min distance
    const results = geoEnabled && origin
      ? base
          .map((x) => {
            if (!x.locs.length) return null

            let best: { dist: number; loc: LocationDTO } | null = null

            for (const loc of x.locs) {
              const plat = loc.lat!
              const plng = loc.lng!

              // bbox pre-check
              if (latDelta != null && lngDelta != null) {
                if (plat < origin.lat - latDelta || plat > origin.lat + latDelta) continue
                if (plng < origin.lng - lngDelta || plng > origin.lng + lngDelta) continue
              }

              const dist = haversineMiles(origin, { lat: plat, lng: plng })
              if (!Number.isFinite(dist)) continue
              if (best == null || dist < best.dist) best = { dist, loc }
            }

            if (!best) return null
            if (best.dist > radiusMiles) return null

            return { ...x, dist: best.dist, closest: best.loc }
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
      : base.map((x) => ({ ...x, dist: null as number | null, closest: x.fallback }))

    // apply filters
    let filtered = results

    if (mobileOnly) {
      filtered = filtered.filter((x) => x.offers.supportsMobile)
    }

    if (maxPrice != null) {
      filtered = filtered.filter((x) => {
        const price = mobileOnly ? x.offers.minMobile : x.offers.minAny
        return price != null && price <= maxPrice
      })
    }

    if (minRating != null) {
      filtered = filtered.filter((x) => x.rating.avg != null && x.rating.avg >= minRating)
    }

    if (openNowOnly) {
      filtered = filtered.filter((x) => {
        const loc = x.closest
        if (!loc) return false
        return isOpenNow({ timeZone: loc.timeZone, workingHours: loc.workingHours })
      })
    }

    // sort
    filtered = filtered.sort((a, b) => {
      if (sort === 'NAME') {
        const an = (a.p.businessName ?? '').toLowerCase()
        const bn = (b.p.businessName ?? '').toLowerCase()
        return an.localeCompare(bn)
      }

      if (sort === 'RATING') {
        const ar = a.rating.avg ?? -1
        const br = b.rating.avg ?? -1
        if (br !== ar) return br - ar
        return (b.rating.count ?? 0) - (a.rating.count ?? 0)
      }

      if (sort === 'PRICE') {
        const ap = (mobileOnly ? a.offers.minMobile : a.offers.minAny) ?? Number.POSITIVE_INFINITY
        const bp = (mobileOnly ? b.offers.minMobile : b.offers.minAny) ?? Number.POSITIVE_INFINITY
        return ap - bp
      }

      // DISTANCE default
      const ad = a.dist ?? Number.POSITIVE_INFINITY
      const bd = b.dist ?? Number.POSITIVE_INFINITY
      return ad - bd
    })

    return jsonOk({
      ok: true,
      pros: filtered.slice(0, 50).map((x) => {
        const loc = x.closest
        const locationLabel =
          x.p.location ??
          (loc?.city ? `${loc.city}${loc.state ? `, ${loc.state}` : ''}` : null)

        return {
          id: x.p.id,
          businessName: x.p.businessName ?? null,
          handle: x.p.handle ?? null,
          professionType: x.p.professionType ?? null,
          avatarUrl: x.p.avatarUrl ?? null,
          locationLabel,
          distanceMiles: x.dist,

          // extra fields your UI can optionally use:
          ratingAvg: x.rating.avg,
          ratingCount: x.rating.count,
          minPrice: mobileOnly ? x.offers.minMobile : x.offers.minAny,
          supportsMobile: x.offers.supportsMobile,

          closestLocation: loc ?? null,
          primaryLocation: x.primary ?? null,
        }
      }),
      services: [],
    })
  } catch (e) {
    console.error('GET /api/search error', e)
    return jsonFail(500, 'Failed to search.')
  }
}