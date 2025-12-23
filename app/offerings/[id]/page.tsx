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
  openingId?: string // optional: BookingPanel reads from URL too, but keep for sanity
  holdId?: string
  holdUntil?: string
}

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

type ServiceLocationType = 'SALON' | 'MOBILE'
type BookingSource = 'DISCOVERY' | 'REQUESTED' | 'AFTERCARE'

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

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function normalizeSource(v: unknown): BookingSource | null {
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
  // Prisma Decimal often has toNumber()
  if (typeof (v as any)?.toNumber === 'function') {
    const n = (v as any).toNumber()
    return Number.isFinite(n) ? n : null
  }
  try {
    const n = Number(String(v))
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args
  if (requested === 'SALON' && offersInSalon) return 'SALON'
  if (requested === 'MOBILE' && offersMobile) return 'MOBILE'
  if (offersInSalon) return 'SALON'
  if (offersMobile) return 'MOBILE'
  return null
}

export default async function OfferingPage(props: PageProps) {
  const params = await props.params
  const id = params?.id
  if (!id || typeof id !== 'string') notFound()

  const sp = props.searchParams ? await props.searchParams : undefined

  const scheduledFor = pickString(sp?.scheduledFor)
  const mediaId = pickString(sp?.mediaId)

  // NOTE: openingId/holdId/holdUntil are intentionally NOT handled here.
  // BookingPanel reads them from useSearchParams and sends openingId automatically.
  // (Keep them in SearchParamsShape for clarity and future server-side UI logic.)

  const proTimeZoneFromUrl = sanitizeTimeZone(pickString(sp?.proTimeZone))
  const requestedLocationType = normalizeLocationType(sp?.locationType)

  const sourceFromUrl = normalizeSource(sp?.source)
  const sourceForPanel: BookingSource = sourceFromUrl ?? 'REQUESTED'

  const offering = await prisma.professionalServiceOffering.findUnique({
    where: { id },
    select: {
      id: true,
      isActive: true,

      title: true,
      description: true,
      customImageUrl: true,

      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: true,
      salonDurationMinutes: true,
      mobilePriceStartingAt: true,
      mobileDurationMinutes: true,

      service: {
        select: {
          id: true,
          name: true,
          description: true,
          category: { select: { name: true } },
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          city: true,
          location: true,
          timeZone: true,
          user: { select: { email: true } },
        },
      },
    },
  })

  if (!offering || !offering.isActive) notFound()

  const user = await getCurrentUser().catch(() => null)
  const isLoggedInAsClient = Boolean(user && user.role === 'CLIENT')

  const svc = offering.service
  const cat = offering.service?.category
  const prof = offering.professional

  const proTimeZoneFromDb = sanitizeTimeZone(prof?.timeZone ?? null)
  const effectiveProTimeZone = proTimeZoneFromUrl ?? proTimeZoneFromDb ?? null

  // ✅ offering capabilities + per-mode fields (new world)
  const offersInSalon = Boolean(offering.offersInSalon)
  const offersMobile = Boolean(offering.offersMobile)

  const salonPriceStartingAt = toNumberOrNull(offering.salonPriceStartingAt)
  const salonDurationMinutes =
    typeof offering.salonDurationMinutes === 'number' ? offering.salonDurationMinutes : null

  const mobilePriceStartingAt = toNumberOrNull(offering.mobilePriceStartingAt)
  const mobileDurationMinutes =
    typeof offering.mobileDurationMinutes === 'number' ? offering.mobileDurationMinutes : null

  // ✅ default mode (for initial selection on BookingPanel)
  const defaultLocationType = pickEffectiveLocationType({
    requested: requestedLocationType,
    offersInSalon,
    offersMobile,
  })

  const titleForUI = offering.title || svc?.name || 'Service'
  const descriptionForUI = offering.description ?? svc?.description ?? ''

  const defaultModeConfigured =
    defaultLocationType === 'SALON'
      ? salonPriceStartingAt !== null && salonDurationMinutes !== null
      : defaultLocationType === 'MOBILE'
        ? mobilePriceStartingAt !== null && mobileDurationMinutes !== null
        : false

  const proName = prof.businessName || prof.user?.email || 'Professional'
  const locationLabel = (prof.city || prof.location) ?? null

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
            {offering.customImageUrl ? 'Pro image here' : 'Default service image here'}
          </div>

          {cat?.name ? <div style={{ fontSize: 13, color: '#777', marginBottom: 4 }}>{cat.name}</div> : null}

          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{titleForUI}</h1>

          <div style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>{descriptionForUI}</div>

          <div style={{ fontSize: 14, color: '#555' }}>
            <strong>{proName}</strong>
            {locationLabel ? <span> · {locationLabel}</span> : null}
          </div>

          {effectiveProTimeZone ? (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
              Appointment timezone: <strong>{effectiveProTimeZone}</strong>
            </div>
          ) : null}

          <div style={{ marginTop: 12, fontSize: 12, color: defaultModeConfigured ? '#6b7280' : '#b91c1c' }}>
            {defaultLocationType ? (
              <>
                Default booking mode: <strong>{defaultLocationType}</strong>
                {!defaultModeConfigured ? ' (pricing/duration not fully set for this mode yet)' : null}
              </>
            ) : (
              <>This offering doesn’t have salon/mobile enabled yet.</>
            )}
          </div>
        </div>

        <BookingPanel
          offeringId={offering.id}
          professionalId={prof.id}
          serviceId={svc.id}
          mediaId={mediaId}

          offersInSalon={offersInSalon}
          offersMobile={offersMobile}
          salonPriceStartingAt={salonPriceStartingAt}
          salonDurationMinutes={salonDurationMinutes}
          mobilePriceStartingAt={mobilePriceStartingAt}
          mobileDurationMinutes={mobileDurationMinutes}

          defaultLocationType={defaultLocationType}

          isLoggedInAsClient={isLoggedInAsClient}
          defaultScheduledForISO={scheduledFor}
          serviceName={titleForUI}
          professionalName={proName}
          locationLabel={locationLabel}
          professionalTimeZone={effectiveProTimeZone}
          source={sourceForPanel}
        />
      </div>
    </main>
  )
}
