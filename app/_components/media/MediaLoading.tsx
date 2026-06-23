// app/_components/media/MediaLoading.tsx
'use client'

import BrandMark from '@/app/_components/footer/BrandMark'
import { cn } from '@/lib/utils'

/**
 * Branded "media is on its way" state: the signature brand feather above a
 * loading bar. Used while an upload is in flight or while a render URL is being
 * resolved, so people never see a bare "Missing media" placeholder for content
 * that is actually loading. When `percent` is provided the bar is determinate;
 * otherwise it animates as an indeterminate pulse.
 */
export default function MediaLoading({
  percent,
  label,
  className,
}: {
  percent?: number | null
  label?: string
  className?: string
}) {
  const hasPercent =
    typeof percent === 'number' && Number.isFinite(percent) && percent >= 0

  const clamped = hasPercent ? Math.min(100, Math.max(0, percent)) : null

  return (
    <div
      className={cn(
        'grid h-full w-full place-items-center bg-bgPrimary/40 px-6',
        className,
      )}
    >
      <div className="flex w-full max-w-[180px] flex-col items-center gap-3">
        <div className="animate-pulse">
          <BrandMark size={40} title="Loading media" />
        </div>

        <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full bg-accentPrimary transition-[width] duration-200 ease-out',
              clamped === null ? 'w-1/3 animate-pulse' : '',
            )}
            style={clamped === null ? undefined : { width: `${clamped}%` }}
            role="progressbar"
            aria-valuenow={clamped ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        {label ? (
          <div className="text-[11px] font-black text-textSecondary">
            {label}
          </div>
        ) : null}
      </div>
    </div>
  )
}
