// app/(main)/booking/AvailabilityDrawer/components/ProCard.tsx

'use client'

import Link from 'next/link'
import type { ProCard as Pro } from '../types'

export default function ProCard({
  pro,
  appointmentTz,
  viewerTz,
  statusLine,
  showFallbackActions,
  viewProServicesHref,
  onScrollToOtherPros,
}: {
  pro: Pro
  appointmentTz: string
  viewerTz: string | null
  statusLine: string
  showFallbackActions: boolean
  viewProServicesHref: string
  onScrollToOtherPros: () => void
}) {
  const showLocalHint = Boolean(viewerTz && viewerTz !== appointmentTz)

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-full bg-white/10">
          {pro.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pro.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/professionals/${pro.id}`} className="truncate text-[15px] font-black text-textPrimary">
              {pro.businessName || 'Professional'}
            </Link>

            <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1 text-[11px] font-black text-textPrimary">
              ⭐ Creator
            </span>
          </div>

          <div className="mt-1 text-[12px] font-semibold text-textSecondary">{pro.location ? pro.location : ' '}</div>

          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Times in <span className="font-black text-textPrimary">{appointmentTz}</span>
            {showLocalHint ? <span> · You: {viewerTz}</span> : null}
          </div>

          <div className="mt-2 text-[12px] font-semibold text-textSecondary">{statusLine}</div>

          {showFallbackActions ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link
                href={viewProServicesHref}
                className="flex h-10 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/35 text-[12px] font-black text-textPrimary hover:bg-white/10"
              >
                View other services
              </Link>

              <button
                type="button"
                onClick={onScrollToOtherPros}
                className="h-10 rounded-full border border-white/10 bg-bgPrimary/35 text-[12px] font-black text-textPrimary hover:bg-white/10"
              >
                See other pros
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
