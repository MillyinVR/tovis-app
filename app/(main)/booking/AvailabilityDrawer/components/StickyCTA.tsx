'use client'

export default function StickyCTA({
  canContinue,
  loading,
  onContinue,
  selectedLine,
}: {
  canContinue: boolean
  loading: boolean
  onContinue: () => void
  selectedLine: string | null
}) {
  return (
    <div className="tovis-glass-soft fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-bgPrimary/60 backdrop-blur">
      <div className="mx-auto max-w-180 px-4 py-3">
        {selectedLine ? (
          <div className="mb-2 text-[12px] font-semibold text-textSecondary">
            Held: <span className="font-black text-textPrimary">{selectedLine}</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue || loading}
          className="flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {loading ? 'Holding…' : 'Review & customize'}
        </button>

        <div className="mt-2 text-center text-[11px] font-semibold text-textSecondary">
          No charge yet. The pro confirms next.
        </div>
      </div>
    </div>
  )
}
