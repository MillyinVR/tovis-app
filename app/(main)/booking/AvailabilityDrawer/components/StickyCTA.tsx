// app/(main)/booking/AvailabilityDrawer/components/StickyCTA.tsx

'use client'

import { cn } from '@/lib/utils'

type StickyCTAProps = {
  canContinue: boolean
  loading: boolean
  onContinue: () => void
  selectedLine: string | null
  continueLabel: string
}

export default function StickyCTA({
  canContinue,
  loading,
  onContinue,
  selectedLine,
  continueLabel,
}: StickyCTAProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-bgPrimary/60 backdrop-blur">
      <div className="mx-auto max-w-180 px-4 py-3">
        <div className="tovis-glass-soft rounded-card border border-white/10 px-4 py-3">
          {selectedLine ? (
            <div className="mb-2 text-[12px] font-semibold text-textSecondary">
              Time held:{' '}
              <span className="font-black text-textPrimary">{selectedLine}</span>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue || loading}
            className={cn(
              'flex h-12 w-full items-center justify-center rounded-full border border-white/10',
              'bg-accentPrimary text-[14px] font-black text-bgPrimary transition',
              'hover:bg-accentPrimaryHover',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {loading ? 'Holding your time...' : continueLabel}
          </button>

          <div className="mt-2 text-center text-[11px] font-semibold text-textSecondary">
            No charge yet. The pro confirms next.
          </div>
        </div>
      </div>
    </div>
  )
}