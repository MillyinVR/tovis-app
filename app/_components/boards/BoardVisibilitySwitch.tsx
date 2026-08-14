// app/_components/boards/BoardVisibilitySwitch.tsx
'use client'

import type { BoardVisibility } from '@prisma/client'

import { COPY } from '@/lib/copy'
import { useBoardVisibility } from './useBoardVisibility'

/**
 * The compact private/shared switch that sits on a board card in the owner's
 * list — so a board can be shared or un-shared without opening it.
 *
 * The board detail page keeps its fuller panel (which also offers the link to
 * copy); both drive the same mutation through `useBoardVisibility`.
 */
export default function BoardVisibilitySwitch({
  boardId,
  initialVisibility,
  onChanged,
}: {
  boardId: string
  initialVisibility: BoardVisibility
  onChanged?: (next: BoardVisibility) => void
}) {
  const { isShared, busy, error, toggle } = useBoardVisibility({
    boardId,
    initial: initialVisibility,
    onChanged,
  })

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isShared}
        aria-label={COPY.boards.visibilityToggleLabel}
        title={isShared ? COPY.boards.makeSharedHint : COPY.boards.makePrivateHint}
        disabled={busy}
        onClick={(event) => {
          // The card behind this is a link; without both, tapping the switch
          // would navigate to the board instead of flipping it.
          event.preventDefault()
          event.stopPropagation()
          void toggle()
        }}
        className={[
          'tap-target-keep flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.07em] backdrop-blur-md transition',
          isShared
            ? 'border-toneWarn/35 bg-bgPrimary/75 text-toneWarn'
            : 'border-textPrimary/15 bg-bgPrimary/75 text-textSecondary hover:text-textPrimary',
          busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'block h-1 w-1 rounded-full',
            isShared ? 'bg-toneWarn' : 'bg-textSecondary',
          ].join(' ')}
        />
        {isShared
          ? COPY.boards.visibilityShared
          : COPY.boards.visibilityPrivate}
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
