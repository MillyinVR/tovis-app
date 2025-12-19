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

export default async function OfferingPage(props: PageProps) {
  const params = await props.params
  const id = params?.id
  if (!id || typeof id !== 'string') notFound()

  const sp = props.searchParams ? await props.searchParams : undefined

  const scheduledFor = pickString(sp?.scheduledFor)
  const mediaId = pickString(sp?.mediaId)
  const proTimeZoneFromUrl = sanitizeTimeZone(pickString(sp?.proTimeZone))

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

  const source = pickString(sp?.source)

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

          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{svc?.name ?? 'Service'}</h1>

          <div style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>
            {offering.description ?? svc?.description ?? ''}
          </div>

          <div style={{ fontSize: 14, color: '#555' }}>
            <strong>{prof.businessName || prof.user?.email || 'Professional'}</strong>
            {prof.city || prof.location ? <span> · {prof.city || prof.location}</span> : null}
          </div>

          {effectiveProTimeZone ? (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
              Appointment timezone: <strong>{effectiveProTimeZone}</strong>
            </div>
          ) : null}
        </div>

        <BookingPanel
          offeringId={offering.id}
          professionalId={prof.id}
          serviceId={svc.id}
          mediaId={mediaId}
          price={Number(offering.price)}
          durationMinutes={offering.durationMinutes}
          isLoggedInAsClient={isLoggedInAsClient}
          defaultScheduledForISO={scheduledFor}
          serviceName={svc?.name ?? null}
          professionalName={prof.businessName || prof.user?.email || null}
          locationLabel={(prof.city || prof.location) ?? null}
          professionalTimeZone={effectiveProTimeZone}
          source={source ?? 'REQUESTED'}
        />
      </div>
    </main>
  )
}
