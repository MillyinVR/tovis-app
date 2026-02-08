// app/pro/bookings/[id]/session/after-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'

import { getCurrentUser } from '@/lib/currentUser'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import MediaUploader from '../MediaUploader'
import { getServerOrigin } from '@/lib/serverOrigin'

export const dynamic = 'force-dynamic'

type ApiItem = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  createdAt: string
  reviewId: string | null

  signedUrl: string | null
  signedThumbUrl: string | null
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function Card(props: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('tovis-glass mt-3 rounded-card border border-white/10 bg-bgSecondary p-4', props.className)}>
      {props.children}
    </div>
  )
}

function safeDateString(raw: unknown, timeZone: string) {
  try {
    const d = new Date(String(raw))
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return ''
  }
}

/**
 * ✅ Long-term correctness:
 * - forwards cookies to API so requirePro() works
 * - supports absolute or relative base URL
 */
async function fetchProMedia(bookingId: string, phase: 'AFTER') {
  const origin = (await getServerOrigin()) || ''
  const url = origin
    ? `${origin}/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=${phase}`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=${phase}`

  // Forward auth cookies so your API can validate the pro
  const h = await headers()
  const cookie = h.get('cookie') ?? ''

  const res = await fetch(url, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  }).catch(() => null)

  if (!res?.ok) return [] as ApiItem[]

  const data = (await res.json().catch(() => ({}))) as any
  return (data?.items ?? []) as ApiItem[]
}

type PageProps = { params: Promise<{ id: string }> }

export default async function ProAfterPhotosPage(props: PageProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/after-photos`)
  }

  const proTz = sanitizeTimeZone(user.professionalProfile.timeZone, DEFAULT_TIME_ZONE)

  // ✅ pull signed URLs via API (requires cookies forwarded)
  const items = await fetchProMedia(bookingId, 'AFTER')

  const canContinue = items.length > 0

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 text-textPrimary">
      <Link
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        className="text-xs font-black text-textSecondary hover:opacity-80"
      >
        ← Back to session
      </Link>

      <h1 className="mt-3 text-lg font-black">After photos</h1>

      <Card>
        <div className="text-sm text-textSecondary">
          Add at least one after photo to unlock aftercare. Saved{' '}
          <span className="font-black text-textPrimary">privately</span>.
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
      </Card>

      <section className="mt-4">
        <MediaUploader bookingId={bookingId} phase="AFTER" />
      </section>

      <section className="mt-5">
        <div className="text-sm font-black">Uploaded after media</div>

        {items.length === 0 ? (
          <div className="mt-2 text-sm text-textSecondary">None yet.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {items.map((m) => {
              const src = m.signedThumbUrl || m.signedUrl
              const wasReleased = Boolean(m.reviewId)
              const when = safeDateString(m.createdAt, proTz)

              return (
                <div key={m.id} className="rounded-card border border-white/10 bg-bgSecondary p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-black text-textPrimary">
                    <span>{m.mediaType} · PRIVATE</span>
                    {when ? <span className="font-semibold text-textSecondary">· {when}</span> : null}
                  </div>

                  {m.caption ? <div className="mt-1 text-sm text-textSecondary">{m.caption}</div> : null}

                  {src ? (
                    <div className="mt-2 overflow-hidden rounded-card border border-white/10 bg-bgPrimary">
                      {m.mediaType === 'VIDEO' ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={src} controls className="block h-56 w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="After media" className="block h-44 w-full object-cover" />
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-card border border-white/10 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
                      Couldn’t generate a signed URL (file missing or storage error).
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-black">
                    {m.signedUrl ? (
                      <a href={m.signedUrl} target="_blank" rel="noreferrer" className="text-accentPrimary hover:opacity-80">
                        Open media
                      </a>
                    ) : null}
                  </div>

                  <div className="mt-2 text-[11px] font-semibold text-textSecondary">
                    {wasReleased
                      ? 'Client attached this to a review (released).'
                      : 'Stays private unless the client attaches it to a review.'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
