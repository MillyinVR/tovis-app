// app/offerings/[id]/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingPanel from './BookingPanel'

export const dynamic = 'force-dynamic'

type SearchParamsShape = {
  scheduledFor?: string
  mediaId?: string
  proTimeZone?: string
  source?: string
  locationType?: string // "SALON" | "MOBILE"
  // Optional: these are used by BookingPanel via useSearchParams anyway
  holdId?: string
  holdUntil?: string
}

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function sanitizeTimeZone(tz: string | null): string | null {
  if (!tz) return null
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_\-+]+$/.test(tz)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return null
  }
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function normalizeLocationType(v: unknown): 'SALON' | 'MOBILE' | null {
  const s = upper(v)
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

// ✅ Option A: validate + normalize booking source on the server page
function normalizeSource(v: unknown): 'DISCOVERY' | 'REQUESTED' | 'AFTERCARE' | null {
  const s = upper(v)
  if (s === 'DISCOVERY') return 'DISCOVERY'
  if (s === 'REQUESTED') return 'REQUESTED'
  if (s === 'AFTERCARE') return 'AFTERCARE'
  return null
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  try {
    const n = Number(String(v))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export default async function OfferingPage(props: PageProps) {
  const params = await props.params
  const id = params?.id
  if (!id || typeof id !== 'string') notFound()

  const sp = props.searchParams ? await props.searchParams : undefined

  const scheduledFor = pickString(sp?.scheduledFor)
  const mediaId = pickString(sp?.mediaId)
  const proTimeZoneFromUrl = sanitizeTimeZone(pickString(sp?.proTimeZone))
  const requestedLocationType = normalizeLocationType(sp?.locationType)

  // ✅ normalized + validated
  const sourceFromUrl = normalizeSource(sp?.source)
  const sourceForPanel = sourceFromUrl ?? 'REQUESTED'

  const offering = await prisma.professionalServiceOffering.findUnique({
    where: { id },
    include: {
      service: { include: { category: true } },
      professional: { include: { user: true } },
    },
  })

  if (!offering || !offering.isActive) notFound()

  const user = await getCurrentUser().catch(() => null)
  const isLoggedInAsClient = Boolean(user && user.role === 'CLIENT')

  const svc = offering.service
  const cat = svc?.category
  const prof = offering.professional

  const proTimeZoneFromDb = sanitizeTimeZone((prof as any)?.timeZone ?? null)
  const effectiveProTimeZone = proTimeZoneFromUrl ?? proTimeZoneFromDb ?? null

  // ---- choose SALON vs MOBILE and pick correct price/duration ----
  const offersSalon = Boolean((offering as any).offersInSalon)
  const offersMobile = Boolean((offering as any).offersMobile)

  const salonPrice = toNumberOrNull((offering as any).salonPriceStartingAt)
  const salonDuration = typeof (offering as any).salonDurationMinutes === 'number' ? (offering as any).salonDurationMinutes : null

  const mobilePrice = toNumberOrNull((offering as any).mobilePriceStartingAt)
  const mobileDuration = typeof (offering as any).mobileDurationMinutes === 'number' ? (offering as any).mobileDurationMinutes : null

  let effectiveLocationType: 'SALON' | 'MOBILE' | null = null
  if (requestedLocationType === 'SALON' && offersSalon) effectiveLocationType = 'SALON'
  else if (requestedLocationType === 'MOBILE' && offersMobile) effectiveLocationType = 'MOBILE'
  else if (offersSalon) effectiveLocationType = 'SALON'
  else if (offersMobile) effectiveLocationType = 'MOBILE'
  else effectiveLocationType = null

  const fallbackDuration = typeof svc?.defaultDurationMinutes === 'number' ? svc.defaultDurationMinutes : 60
  const fallbackPrice = toNumberOrNull((svc as any)?.minPrice) ?? 0

  let priceForPanel = fallbackPrice
  let durationForPanel = fallbackDuration

  if (effectiveLocationType === 'SALON') {
    if (salonPrice !== null) priceForPanel = salonPrice
    if (salonDuration !== null) durationForPanel = salonDuration
  } else if (effectiveLocationType === 'MOBILE') {
    if (mobilePrice !== null) priceForPanel = mobilePrice
    if (mobileDuration !== null) durationForPanel = mobileDuration
  }

  const hasRealPricing =
    (effectiveLocationType === 'SALON' && salonPrice !== null && salonDuration !== null) ||
    (effectiveLocationType === 'MOBILE' && mobilePrice !== null && mobileDuration !== null)

  const titleForUI = (offering as any).title || svc?.name || 'Service'
  const descriptionForUI = (offering as any).description ?? svc?.description ?? ''

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a href="/explore" style={{ fontSize: 13, color: '#555', textDecoration: 'none' }}>
        ← Back to explore
      </a>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, marginTop: 16 }}>
        <div>
          <div
            style={{
              background: '#f5f5f5',
              borderRadius: 12,
              height: 260,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              color: '#777',
            }}
          >
            {(offering as any).customImageUrl ? 'Pro image here' : 'Default service image here'}
          </div>

          {cat?.name ? <div style={{ fontSize: 13, color: '#777', marginBottom: 4 }}>{cat.name}</div> : null}

          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{titleForUI}</h1>

          <div style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>{descriptionForUI}</div>

          <div style={{ fontSize: 14, color: '#555' }}>
            <strong>{prof.businessName || prof.user?.email || 'Professional'}</strong>
            {prof.city || prof.location ? <span> · {prof.city || prof.location}</span> : null}
          </div>

          {effectiveProTimeZone ? (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
              Appointment timezone: <strong>{effectiveProTimeZone}</strong>
            </div>
          ) : null}

          <div style={{ marginTop: 12, fontSize: 12, color: hasRealPricing ? '#6b7280' : '#b91c1c' }}>
            {effectiveLocationType ? (
              <>
                Booking mode: <strong>{effectiveLocationType}</strong>
                {!hasRealPricing ? ' (pricing not fully set for this mode yet)' : null}
              </>
            ) : (
              <>This offering doesn’t have salon/mobile settings configured yet.</>
            )}
          </div>
        </div>

        <BookingPanel
          offeringId={offering.id}
          professionalId={prof.id}
          serviceId={svc.id}
          mediaId={mediaId}
          price={priceForPanel}
          durationMinutes={durationForPanel}
          isLoggedInAsClient={isLoggedInAsClient}
          defaultScheduledForISO={scheduledFor}
          serviceName={titleForUI}
          professionalName={prof.businessName || prof.user?.email || null}
          locationLabel={(prof.city || prof.location) ?? null}
          professionalTimeZone={effectiveProTimeZone}
          source={sourceForPanel}
        />
      </div>
    </main>
  )
}
