// app/pro/bookings/[id]/session/after-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import MediaUploader from '../MediaUploader'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function fmtInTimeZone(value: unknown, timeZone: string) {
  try {
    const d = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(d.getTime())) return ''
    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return ''
  }
}

export default async function ProAfterPhotosPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/after-photos`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, client: true },
  })
  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const step = upper((booking as any).sessionStep || 'NONE')
  if (step !== 'AFTER_PHOTOS' && step !== 'DONE') {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  // ✅ Use PRO timezone. No LA fallback. If missing/invalid, fall back to DEFAULT_TIME_ZONE (UTC).
  const proTz = sanitizeTimeZone(user.professionalProfile.timeZone, DEFAULT_TIME_ZONE)

  const items = await prisma.mediaAsset.findMany({
    where: { bookingId, phase: 'AFTER' as any },
    select: {
      id: true,
      url: true,
      thumbUrl: true,
      caption: true,
      mediaType: true,
      visibility: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const serviceName = booking.service?.name ?? 'Service'
  const clientFirst = booking.client?.firstName ?? ''
  const clientLast = booking.client?.lastName ?? ''
  const clientName = `${clientFirst} ${clientLast}`.trim() || 'Client'
  const canContinue = items.length > 0

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 text-textPrimary">
      <Link
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        className="text-xs font-black text-textSecondary hover:opacity-80"
      >
        ← Back to session
      </Link>

      <h1 className="mt-3 text-lg font-black">After photos: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">Client: {clientName}</div>

      <div className="tovis-glass mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-sm text-textSecondary">
          Add at least one after photo to unlock aftercare. Your footer button should advance you once you’ve added one.
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href={canContinue ? `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare` : '#'}
            aria-disabled={!canContinue}
            className={[
              'rounded-full px-4 py-2 text-xs font-black transition',
              canContinue
                ? 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
                : 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-70 pointer-events-none',
            ].join(' ')}
          >
            Continue to aftercare
          </Link>

          {!canContinue ? (
            <span className="text-xs font-semibold text-textSecondary">No after media yet. Add one to continue.</span>
          ) : (
            <span className="text-xs font-black text-textPrimary">Unlocked.</span>
          )}
        </div>

        <div className="mt-3 text-[11px] font-semibold text-textSecondary">
          Times shown in <span className="font-black text-textPrimary">{proTz}</span>
        </div>
      </div>

      <section className="mt-4">
        <MediaUploader bookingId={bookingId} phase="AFTER" />
      </section>

      <section className="mt-5">
        <div className="text-sm font-black">Uploaded after media</div>

        {items.length === 0 ? (
          <div className="mt-2 text-sm text-textSecondary">None yet.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {items.map((m) => (
              <div key={m.id} className="rounded-card border border-white/10 bg-bgSecondary p-3">
                <div className="text-xs font-black text-textPrimary">
                  {m.mediaType} · {m.visibility}
                  <span className="ml-2 font-semibold text-textSecondary">
                    · {fmtInTimeZone(m.createdAt, proTz)}
                  </span>
                </div>

                {m.caption ? <div className="mt-1 text-sm text-textSecondary">{m.caption}</div> : null}

                <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-textSecondary">
                  {m.isEligibleForLooks ? <span>Eligible for Looks</span> : null}
                  {m.isFeaturedInPortfolio ? <span>Featured</span> : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-3 text-xs font-black">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-accentPrimary hover:opacity-80">
                    Open media
                  </a>
                  {m.thumbUrl ? (
                    <a
                      href={m.thumbUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accentPrimary hover:opacity-80"
                    >
                      Open thumb
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
