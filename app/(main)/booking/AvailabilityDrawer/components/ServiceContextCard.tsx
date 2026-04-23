// app/(main)/booking/AvailabilityDrawer/components/ServiceContextCard.tsx
'use client'

import type { AvailabilityOffering, ServiceLocationType } from '../types'

type Props = {
  serviceName?: string | null
  categoryName?: string | null
  offering: AvailabilityOffering
  locationType: ServiceLocationType
}

const LOCATION_LABEL: Record<ServiceLocationType, string> = {
  MOBILE: 'Mobile',
  SALON: 'In-salon',
}

function formatUsdMoneyString(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (!value) return null
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null

  const amount = Number(value)
  if (!Number.isFinite(amount)) return null

  const hasCents = !value.endsWith('.00')

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDuration(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return null
  }

  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function getOfferingDuration(
  offering: AvailabilityOffering,
  locationType: ServiceLocationType,
): number | null {
  return locationType === 'MOBILE'
    ? offering.mobileDurationMinutes ?? null
    : offering.salonDurationMinutes ?? null
}

function getOfferingStartingAt(
  offering: AvailabilityOffering,
  locationType: ServiceLocationType,
): string | null {
  return locationType === 'MOBILE'
    ? offering.mobilePriceStartingAt ?? null
    : offering.salonPriceStartingAt ?? null
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-white/10 bg-bgPrimary/35 px-[10px] py-[3px] font-mono text-[11px] font-bold tracking-[0.04em] text-textSecondary">
      {children}
    </span>
  )
}

export default function ServiceContextCard({
  serviceName,
  categoryName,
  offering,
  locationType,
}: Props) {
  const title = serviceName?.trim() ?? ''
  const category = categoryName?.trim() ?? ''

  const durationLabel = formatDuration(
    getOfferingDuration(offering, locationType),
  )

  const priceLabel = formatUsdMoneyString(
    getOfferingStartingAt(offering, locationType),
  )

  if (!title && !durationLabel && !priceLabel) return null

  return (
    <div className="mb-4">
      {title ? (
        <div className="mb-2 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-black text-textPrimary">
          {title}
          {category ? (
            <span className="ml-2 text-[12px] font-semibold text-textSecondary">
              {category}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-[6px]">
        {durationLabel ? <MetaPill>{durationLabel}</MetaPill> : null}
        {priceLabel ? <MetaPill>From {priceLabel}</MetaPill> : null}
        <MetaPill>{LOCATION_LABEL[locationType]}</MetaPill>
      </div>
    </div>
  )
}