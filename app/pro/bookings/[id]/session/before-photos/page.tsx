// app/pro/bookings/[id]/session/before-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import MediaUploader from '../MediaUploader'

export const dynamic = 'force-dynamic'

function fmtDate(v: any) {
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
  } catch {
    return ''
  }
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="tovis-glass mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">{children}</div>
}

export default async function ProBeforePhotosPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, client: true, consultationApproval: true },
  })
  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const bookingStatus = upper(booking.status)
  const approvalStatus = upper((booking as any).consultationApproval?.status || 'NONE')
  const consultationApproved = approvalStatus === 'APPROVED'

  if (!booking.startedAt || booking.finishedAt || bookingStatus === 'CANCELLED' || bookingStatus === 'COMPLETED') {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  if (!consultationApproved) {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  const items = await prisma.mediaAsset.findMany({
    where: { bookingId, phase: 'BEFORE' as any },
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

  const hasBefore = items.length > 0

  async function continueToService() {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    if (!u || u.role !== 'PRO' || !u.professionalProfile?.id) {
      redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)
    }

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
        consultationApproval: { select: { status: true } },
      },
    })

    if (!b) notFound()
    if (b.professionalId !== u.professionalProfile.id) redirect('/pro')

    const st = upper(b.status)
    const appr = upper(b.consultationApproval?.status || 'NONE')

    if (st === 'CANCELLED' || st === 'COMPLETED' || b.finishedAt) redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    if (!b.startedAt) redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    if (appr !== 'APPROVED') redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    const count = await prisma.mediaAsset.count({ where: { bookingId, phase: 'BEFORE' as any } })
    if (count <= 0) redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)

    await prisma.booking.update({
      where: { id: bookingId },
      data: { sessionStep: 'SERVICE_IN_PROGRESS' as any },
    })

    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/service`)
  }

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 text-textPrimary">
      <Link
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        className="text-xs font-black text-textSecondary hover:opacity-80"
      >
        ← Back to session
      </Link>

      <h1 className="mt-3 text-lg font-black">Before photos: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">Client: {clientName}</div>

      {hasBefore ? (
        <Card>
          <div className="text-sm font-black text-textPrimary">Before photos saved ✅</div>
          <div className="mt-1 text-sm text-textSecondary">
            Continue to the service hub page where you can keep notes during the appointment.
          </div>

          <form action={continueToService} className="mt-3">
            <button
              type="submit"
              className="rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
            >
              Continue to service
            </button>
          </form>
        </Card>
      ) : (
        <Card>
          <div className="text-sm font-black text-textPrimary">Take at least one before photo</div>
          <div className="mt-1 text-sm text-textSecondary">Once you upload at least one image, a Continue button will appear.</div>
        </Card>
      )}

      <section className="mt-4">
        <MediaUploader bookingId={bookingId} phase="BEFORE" />
      </section>

      <section className="mt-5">
        <div className="text-sm font-black">Uploaded before media</div>

        {items.length === 0 ? (
          <div className="mt-2 text-sm text-textSecondary">None yet.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {items.map((m) => (
              <div key={m.id} className="rounded-card border border-white/10 bg-bgSecondary p-3">
                <div className="text-xs font-black text-textPrimary">
                  {m.mediaType} · {m.visibility}
                  <span className="ml-2 font-semibold text-textSecondary">· {fmtDate(m.createdAt)}</span>
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
                    <a href={m.thumbUrl} target="_blank" rel="noreferrer" className="text-accentPrimary hover:opacity-80">
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
