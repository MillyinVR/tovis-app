'use client'

import type { LookPostVisibility } from '@prisma/client'

import { COPY } from '@/lib/copy'
import { useLookVisibility } from './useLookVisibility'

/**
 * The compact public/private switch that rides a history card on `/client/me`.
 *
 * Screen 7 folded this onto the card for the visit the look came out of, and
 * dropped the separate "Your looks" grid — so a client sees ONE picture-led
 * list of their visits rather than two lists holding two halves of the same
 * thing.
 *
 * Visually the twin of `BoardVisibilitySwitch` on purpose: the same control,
 * doing the same job, on the same screen.
 */
export default function LookVisibilitySwitch({
  lookId,
  initialVisibility,
  lookName,
  onChanged,
}: {
  lookId: string
  initialVisibility: LookPostVisibility | string
  /** Named in the accessible label so a list of switches is distinguishable. */
  lookName?: string
  onChanged?: (nextIsPublic: boolean) => void
}) {
  const { isPublic, busy, error, toggle } = useLookVisibility({
    lookId,
    initial: initialVisibility,
    onChanged,
  })

  const label = lookName
    ? `${COPY.clientLooks.visibilityToggleLabel} — ${lookName}`
    : COPY.clientLooks.visibilityToggleLabel

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isPublic}
        aria-label={label}
        title={
          isPublic
            ? COPY.clientLooks.makePublicHint
            : COPY.clientLooks.makePrivateHint
        }
        disabled={busy}
        onClick={(event) => {
          // The card behind this is a link; without both, tapping the switch
          // would open the booking instead of flipping the look.
          event.preventDefault()
          event.stopPropagation()
          void toggle()
        }}
        className={[
          'tap-target-keep brand-focus flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.07em] backdrop-blur-md transition',
          isPublic
            ? 'border-accentPrimary/35 bg-bgPrimary/75 text-accentPrimary'
            : 'border-textPrimary/15 bg-bgPrimary/75 text-textSecondary hover:text-textPrimary',
          busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'block h-1 w-1 rounded-full',
            isPublic ? 'bg-accentPrimary' : 'bg-textSecondary',
          ].join(' ')}
        />
        {isPublic
          ? COPY.clientLooks.visibilityPublic
          : COPY.clientLooks.visibilityPrivate}
      </button>

      {error ? (
        <span
          role="status"
          className="max-w-[180px] rounded-md bg-bgPrimary/85 px-2 py-1 text-right text-[10px] font-semibold text-toneDanger"
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
