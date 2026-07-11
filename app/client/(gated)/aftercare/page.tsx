// app/client/aftercare/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/currentUser'
import AftercareBeforeAfter from '@/app/_components/aftercare/AftercareBeforeAfter'
import ProProfileLink from '@/app/client/(gated)/components/ProProfileLink'
import { COPY } from '@/lib/copy'
import { formatInTimeZone } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import {
  aftercareInboxHintMode,
  loadClientAftercareInbox,
} from '@/lib/aftercare/loadClientAftercareInbox'

export const dynamic = 'force-dynamic'

function formatDateInTz(iso: string, timeZone: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  return formatInTimeZone(d, tz, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function SmallPill({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-accentPrimary/35 bg-accentPrimary/12 px-2 py-0.5 text-[10px] font-black tracking-wide text-accentPrimary">
      {label}
    </span>
  )
}

export default async function ClientAftercareInboxPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client/aftercare')
  }

  const rows = await loadClientAftercareInbox(user.clientProfile.id)

  return (
    <main className="mx-auto w-full max-w-860px px-4 pb-24 pt-7 text-textPrimary">
      <h1 className="text-[22px] font-black">{COPY.aftercareInbox.title}</h1>
      <div className="mt-1 text-[13px] font-semibold text-textSecondary">
        {COPY.aftercareInbox.subtitle}
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-sm font-black text-textPrimary">
            {COPY.aftercareInbox.emptyTitle}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-textSecondary">
            {COPY.aftercareInbox.emptyBody}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5">
          {rows.map((item) => {
            const href = item.bookingId
              ? `/client/bookings/${encodeURIComponent(item.bookingId)}?step=aftercare`
              : null

            const tz = sanitizeTimeZone(item.timeZone, DEFAULT_TIME_ZONE)
            const dateLabel = item.scheduledFor
              ? formatDateInTz(item.scheduledFor, tz)
              : ''

            const hintMode = aftercareInboxHintMode(item)
            const hint =
              hintMode === 'RECOMMENDED_WINDOW'
                ? COPY.aftercareInbox.hintRecommendedWindow
                : hintMode === 'RECOMMENDED_DATE'
                  ? COPY.aftercareInbox.hintRecommendedDate
                  : COPY.aftercareInbox.hintNotes

            return (
              <div
                key={item.notificationId}
                className={[
                  'rounded-card border border-white/10 bg-bgSecondary p-4',
                  href ? '' : 'opacity-70',
                ].join(' ')}
              >
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="text-[14px] font-black text-textPrimary">
                      {item.title}
                      {item.unread ? <SmallPill label={COPY.aftercareInbox.newPill} /> : null}
                    </div>

                    <div className="text-[12px] font-semibold text-textSecondary">
                      {dateLabel ? (
                        <>
                          {dateLabel} <span className="opacity-75">· {tz}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <ProProfileLink
                      proId={item.proId}
                      label={item.proName}
                      className="text-textSecondary font-semibold hover:opacity-80"
                    />
                  </div>

                  {item.beforeAfter ? (
                    <AftercareBeforeAfter
                      media={item.beforeAfter}
                      serviceName={item.title}
                    />
                  ) : null}

                  <div className="text-[12px] font-semibold text-textSecondary/90">
                    {hint}
                  </div>

                  {item.body ? (
                    <div className="text-[12px] font-semibold leading-snug text-textSecondary/90">
                      {item.body}
                    </div>
                  ) : null}

                  {href ? (
                    <Link
                      href={href}
                      aria-label={`Open aftercare: ${item.title}`}
                      className="mt-1 inline-flex w-fit rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
                    >
                      {COPY.aftercareInbox.openCta}
                    </Link>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
