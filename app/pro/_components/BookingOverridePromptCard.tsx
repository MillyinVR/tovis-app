// app/pro/_components/BookingOverridePromptCard.tsx
'use client'

// The soft-confirmation card for an override-gated scheduling refusal
// (OUTSIDE_WORKING_HOURS / ADVANCE_NOTICE_REQUIRED / MAX_DAYS_AHEAD_EXCEEDED):
// the server refused with a gated `code`, and instead of dead-ending, the form
// shows the matching question + a checkbox that authorizes the retry flag.
// Shared by the new-booking form and the aftercare rebook flow so the copy and
// behavior can't drift between the two pro booking surfaces.

import type { BookingOverridePrompt } from '@/lib/booking/overridePrompts'

type Props = {
  prompt: BookingOverridePrompt
  authorized: boolean
  disabled?: boolean
  reason: string
  onToggleAuthorized: (next: boolean) => void
  onReasonChange: (next: string) => void
  /** Label + textarea styling hooks from the host form. */
  helperClassName: string
  fieldClassName: string
}

export default function BookingOverridePromptCard({
  prompt,
  authorized,
  disabled,
  reason,
  onToggleAuthorized,
  onReasonChange,
  helperClassName,
  fieldClassName,
}: Props) {
  return (
    <div className="grid gap-3 rounded-card border border-toneWarn/25 bg-toneWarn/10 p-3">
      <div className="grid gap-1">
        <div className="text-[12px] font-black uppercase tracking-wide text-toneWarn">
          Booking rule override
        </div>
        <div className="text-[12px] text-textSecondary">
          {prompt.question} The override is recorded on the booking.
        </div>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={authorized}
          disabled={disabled}
          onChange={(e) => onToggleAuthorized(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-white/10 bg-bgPrimary"
        />
        <span className="text-[12px] font-black text-textPrimary">
          Book anyway — I’m overriding one of my booking rules
        </span>
      </label>

      <div className="grid gap-2">
        <label htmlFor="overrideReason" className={helperClassName}>
          Reason (optional — shared with your client)
        </label>
        <textarea
          id="overrideReason"
          value={reason}
          disabled={disabled}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={2}
          maxLength={280}
          placeholder={prompt.reasonPlaceholder}
          className={`${fieldClassName} min-h-16 resize-y`}
        />
      </div>
    </div>
  )
}
