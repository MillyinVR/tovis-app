// app/(main)/booking/AvailabilityDrawer/components/StickyCTA.tsx
'use client'

export default function StickyCTA({
  canContinue,
  loading,
  onContinue,
  selectedLine,
}: {
  canContinue: boolean
  loading: boolean
  onContinue: () => void | Promise<void>
  selectedLine?: string | null
}) {
  return (
    <div className="tovis-glass-soft border-t border-white/10 px-4 py-3">
      {selectedLine ? (
        <div className="mb-2 text-[12px] font-semibold text-textSecondary">
          Selected: <span className="font-black text-textPrimary">{selectedLine}</span>
        </div>
      ) : null}

      {canContinue ? (
        <button
          type="button"
          onClick={() => void onContinue()}
          disabled={loading}
          className="flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:cursor-default disabled:opacity-70"
        >
          {loading ? 'Booking…' : 'Continue'}
        </button>
      ) : (
        <div className="flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-bgPrimary/25 text-[13px] font-semibold text-textSecondary">
          Pick a time to continue
        </div>
      )}

      <div className="mt-2 text-center text-[11px] font-semibold text-textSecondary">
        Takes ~10 seconds. No commitment until checkout.
      </div>
    </div>
  )
}
