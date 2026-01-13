'use client'

export function TimePicker(props: {
  proTz: string
  hasHold: boolean
  loading: boolean
  availabilityBusy: boolean
  availabilityError: string | null
  availableSlots: string[]
  value: string | null
  onChange: (iso: string | null) => void
  formatSlotLabel: (iso: string, tz: string) => string
}) {
  const { proTz, hasHold, loading, availabilityBusy, availabilityError, availableSlots, value, onChange, formatSlotLabel } = props

  return (
    <div className="grid gap-2">
      <div className="text-sm">
        Select a time <span className="text-textSecondary">(timezone: </span>
        <span className="font-extrabold">{proTz}</span>
        <span className="text-textSecondary">)</span>
      </div>

      {availabilityBusy ? (
        <div className="text-xs text-textSecondary">Loading availability…</div>
      ) : availabilityError ? (
        <div className="text-xs text-red-200">{availabilityError}</div>
      ) : hasHold ? (
        <div className="text-xs text-textSecondary">Time is locked while the slot is held.</div>
      ) : availableSlots.length === 0 ? (
        <div className="text-xs text-textSecondary">No available times for this day. Pick another day or join the waitlist.</div>
      ) : (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={loading || hasHold}
          className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm disabled:opacity-70"
          title={hasHold ? 'This time is locked because a slot is being held.' : undefined}
        >
          {availableSlots.map((iso) => (
            <option key={iso} value={iso}>
              {formatSlotLabel(iso, proTz)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
