// app/client/components/PrebookedBookings.tsx
'use client'

import type { BookingLike } from './_helpers'
import { prettyWhen, bookingLocationLabel, sourceUpper } from './_helpers'
import ProProfileLink from './ProProfileLink'
import CardLink from './CardLink'

function Pill({ label, tone }: { label: string; tone: 'info' | 'warning' | 'accent' }) {
  const base = 'inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-black whitespace-nowrap'
  const cls =
    tone === 'info'
      ? `${base} border-infoBorder bg-infoSubtle text-info`
      : tone === 'warning'
        ? `${base} border-warningBorder bg-warningSubtle text-warning`
        : `${base} border-accentBorder bg-accentSubtle text-accentPrimary`
  return <span className={cls}>{label}</span>
}

export default function PrebookedBookings({ items }: { items: BookingLike[] }) {
  const list = items ?? []

  return (
    <div className="grid gap-2">
      <div className="text-sm font-black text-textPrimary">Prebooked</div>

      {list.map((b) => {
        const svc = b?.display?.title || b?.display?.baseName || 'Appointment'
        const proLabel = b?.professional?.businessName || 'Professional'
        const proId = b?.professional?.id || null

        const when = prettyWhen(b?.scheduledFor, b?.timeZone)
        const loc = bookingLocationLabel(b)

        const hasUnreadAftercare = Boolean(b?.hasUnreadAftercare)
        const isAftercare = sourceUpper(b?.source) === 'AFTERCARE'

        const href = `/client/bookings/${encodeURIComponent(b.id)}`

        return (
          <CardLink key={b.id} href={href} className="block no-underline">
            <div className="cursor-pointer rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-black">{svc}</div>
                <div className="text-xs font-semibold text-textSecondary">{when}</div>
              </div>

              <div className="mt-1 text-sm">
                <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <ProProfileLink proId={proId} label={proLabel} className="font-black" />
                </span>
                {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill label={isAftercare ? 'Aftercare rebook' : 'Prebooked'} tone="info" />
                <Pill label="Awaiting approval" tone="warning" />
                {hasUnreadAftercare ? <Pill label="New aftercare" tone="accent" /> : null}
              </div>
            </div>
          </CardLink>
        )
      })}

      {list.length === 0 ? (
        <div className="text-sm font-medium text-textSecondary">No prebooked appointments yet.</div>
      ) : null}
    </div>
  )
}
