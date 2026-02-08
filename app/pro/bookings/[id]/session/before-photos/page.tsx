// app/pro/bookings/[id]/session/before-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getServerOrigin } from '@/lib/serverOrigin'
import MediaUploader from '../MediaUploader'

export const dynamic = 'force-dynamic'

type ApiMediaItem = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  createdAt: string | Date
  reviewId: string | null
  signedUrl: string | null
  signedThumbUrl: string | null
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function fmtDate(v: unknown) {
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
  } catch {
    return ''
  }
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Card(props: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('tovis-glass mt-3 rounded-card border border-white/10 bg-bgSecondary p-4', props.className)}>
      {props.children}
    </div>
  )
}

async function fetchBeforeMedia(bookingId: string): Promise<ApiMediaItem[]> {
  const origin = (await getServerOrigin()) || ''
  const url = origin
    ? `${origin}/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=BEFORE`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=BEFORE`

  const res = await fetch(url, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return []

  const data = (await res.json().catch(() => ({}))) as any
  const items = Array.isArray(data?.items) ? data.items : []
  return items as ApiMediaItem[]
}

type PageProps = { params: Promise<{ id: string }> }

export default async function ProBeforePhotosPage(props: PageProps) {
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

  const isCancelled = bookingStatus === 'CANCELLED'
  const isCompleted = bookingStatus === 'COMPLETED' || Boolean(booking.finishedAt)

  // If session isn’t started (or it’s done/cancelled), bounce back.
  if (!booking.startedAt || isCancelled || isCompleted) {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  // ✅ IMPORTANT: load media via API so you get signed URLs (private bucket compatible)
  const items = await fetchBeforeMedia(bookingId)

  const hasBefore = items.length > 0
  const canContinue = consultationApproved && hasBefore

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

    if (!b.startedAt || b.finishedAt) redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    if (st === 'CANCELLED' || st === 'COMPLETED') redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    // hard gate: must be approved
    if (appr !== 'APPROVED') redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    // hard gate: must have at least one BEFORE media uploaded by PRO
    const count = await prisma.mediaAsset.count({
      where: { bookingId, phase: 'BEFORE' as any, uploadedByRole: 'PRO' },
    })
    if (count <= 0) redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)

    await prisma.booking.update({
      where: { id: bookingId },
      data: { sessionStep: 'SERVICE_IN_PROGRESS' as any },
    })

    // If you don’t actually have /session/service, change this href to your real next step.
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

      <Card>
        {!hasBefore ? (
          <>
            <div className="text-sm font-black text-textPrimary">Add at least one before photo</div>
            <div className="mt-1 text-sm text-textSecondary">
              These are saved <span className="font-black text-textPrimary">privately</span> for the client + you. They only become
              public if the client attaches them to a review.
            </div>
          </>
        ) : consultationApproved ? (
          <>
            <div className="text-sm font-black text-textPrimary">Before photos saved ✅</div>
            <div className="mt-1 text-sm text-textSecondary">Consultation is approved — you can continue to the service hub.</div>

            <form action={continueToService} className="mt-3">
              <button
                type="submit"
                className="rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                Continue to service
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="text-sm font-black text-textPrimary">Before photos saved (private) ✅</div>
            <div className="mt-1 text-sm text-textSecondary">
              Client still needs to approve the consultation. You can keep uploading before photos, but service stays locked until approval.
            </div>

            <div className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textSecondary">
              Waiting on approval: {approvalStatus || 'PENDING'}
            </div>
          </>
        )}
      </Card>

      {/* Uploader */}
      <section className="mt-4">
        <MediaUploader bookingId={bookingId} phase="BEFORE" />
      </section>

      {/* List */}
      <section className="mt-5">
        <div className="text-sm font-black">Uploaded before media</div>

        {items.length === 0 ? (
          <div className="mt-2 text-sm text-textSecondary">None yet.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {items.map((m) => {
              const previewSrc = m.signedThumbUrl || m.signedUrl
              const openSrc = m.signedUrl || m.signedThumbUrl
              const wasReleased = Boolean(m.reviewId)

              return (
                <div key={m.id} className="rounded-card border border-white/10 bg-bgSecondary p-3">
                  <div className="text-xs font-black text-textPrimary">
                    {m.mediaType} · PRO_CLIENT
                    <span className="ml-2 font-semibold text-textSecondary">· {fmtDate(m.createdAt)}</span>
                  </div>

                  {m.caption ? <div className="mt-1 text-sm text-textSecondary">{m.caption}</div> : null}

                  {previewSrc ? (
                    <button
                      type="button"
                      className="mt-2 block w-full overflow-hidden rounded-card border border-white/10 bg-bgPrimary"
                      title="Preview"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewSrc} alt="Before photo" className="block h-44 w-full object-cover" />
                    </button>
                  ) : (
                    <div className="mt-2 rounded-card border border-white/10 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
                      Couldn’t generate a signed URL (file missing or storage error).
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-black">
                    {openSrc ? (
                      <a href={openSrc} target="_blank" rel="noreferrer" className="text-accentPrimary hover:opacity-80">
                        Open media
                      </a>
                    ) : null}
                  </div>

                  <div className="mt-2 text-[11px] font-semibold text-textSecondary">
                    {wasReleased ? 'Client attached this to a review (released).' : 'Stays private unless the client attaches it to a review.'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div className="mt-6 text-xs font-semibold text-textSecondary">
        Continue locked: <span className="font-black text-textPrimary">{String(!canContinue)}</span>
      </div>
    </main>
  )
}
