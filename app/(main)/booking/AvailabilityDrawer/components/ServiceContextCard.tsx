// app/(main)/booking/AvailabilityDrawer/components/ServiceContextCard.tsx
'use client'

import type { AvailabilityOffering, ServiceLocationType } from '../types'

function formatUsdMoneyString(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null

  // Expect money strings like "25", "25.0", "25.00"
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null

  const n = Number(s)
  if (!Number.isFinite(n)) return null

  const hasCents = !/\.00$/.test(s)
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n)
}

function formatDuration(min: number | null | undefined) {
  if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return null
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export default function ServiceContextCard({
  serviceName,
  categoryName,
  offering,
  locationType,
}: {
  serviceName?: string | null
  categoryName?: string | null
  offering: AvailabilityOffering
  locationType: ServiceLocationType
}) {
  const duration =
    locationType === 'MOBILE' ? offering.mobileDurationMinutes ?? null : offering.salonDurationMinutes ?? null

  const startingAt =
    locationType === 'MOBILE' ? offering.mobilePriceStartingAt ?? null : offering.salonPriceStartingAt ?? null

  const durationLabel = formatDuration(duration)
  const priceLabel = formatUsdMoneyString(startingAt)

  const title = serviceName?.trim() || 'Service'
  const category = categoryName?.trim() || null

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-black text-textSecondary">You’re booking</div>
          <div className="mt-1 truncate text-[15px] font-black text-textPrimary">{title}</div>
          {category ? <div className="mt-1 text-[12px] font-semibold text-textSecondary">{category}</div> : null}

          <div className="mt-2 flex flex-wrap gap-2 text-[12px] font-semibold text-textSecondary">
            {durationLabel ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1">
                ⏱ <span className="ml-1 font-black text-textPrimary">{durationLabel}</span>
              </span>
            ) : null}

            {priceLabel ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1">
                From <span className="ml-1 font-black text-textPrimary">{priceLabel}</span>
              </span>
            ) : null}

            <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1">
              {locationType === 'MOBILE' ? '🚗 Mobile' : '🏠 In-salon'}
            </span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[11px] font-semibold text-textSecondary">Tip</div>
          <div className="mt-1 text-[12px] font-black text-textPrimary">Customize next</div>
          <div className="mt-0.5 text-[11px] font-semibold text-textSecondary">Add-ons + notes</div>
        </div>
      </div>
    </div>
  )
}