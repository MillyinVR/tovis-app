import { cn } from '@/lib/utils'
import type { PrepCountdown } from '@/lib/booking/prepCountdown'

import PrepChecklistCard, { type PrepChecklistItem } from './PrepChecklistCard'
import SendBoardCard, { type SendableBoard } from './SendBoardCard'

/**
 * "Before you go" — the appointment-prep screen, composed.
 *
 * Order follows the design, and CHANGES SHAPE with how far out the appointment
 * is: past a fortnight the countdown shrinks to one quiet line and the board
 * card is promoted above the checklist, because the useful thing to do six
 * weeks early is send the pro your looks, not tick "arrive with clean hair".
 */

type Props = {
  bookingId: string
  proDisplayName: string
  countdown: PrepCountdown
  /** "Thu, Jun 15 · 11:00 AM" — already formatted in the appointment's zone. */
  whenLabel: string
  items: PrepChecklistItem[]
  checkedItemIds: string[]
  note: string | null
  boards: SendableBoard[]
  sharedBoardIds: string[]
  /** False once the appointment can no longer be prepared for. */
  writable: boolean
  /** Rendered under the hero — the who/where card the page already builds. */
  whereBlock?: React.ReactNode
}

export default function AppointmentPrepSection({
  bookingId,
  proDisplayName,
  countdown,
  whenLabel,
  items,
  checkedItemIds,
  note,
  boards,
  sharedBoardIds,
  writable,
  whereBlock,
}: Props) {
  const isFar = countdown.tone === 'far'

  const boardCard =
    boards.length > 0 ? (
      <SendBoardCard
        bookingId={bookingId}
        proDisplayName={proDisplayName}
        boards={boards}
        initialSharedBoardIds={sharedBoardIds}
        writable={writable}
        emphasis={isFar}
      />
    ) : null

  const checklistCard =
    items.length > 0 ? (
      <PrepChecklistCard
        bookingId={bookingId}
        items={items}
        initialCheckedIds={checkedItemIds}
        writable={writable}
      />
    ) : (
      // The pro wrote nothing — very common early on. Say so plainly rather
      // than leaving a heading over blank space.
      //
      // ⚠️ Deliberately carries NO "send board" button: the board card renders
      // directly below with the same call to action, and the design's own frame
      // showed both at once — two doors onto one decision.
      <section className="rounded-card border border-textPrimary/10 bg-bgPrimary p-4">
        <h2 className="text-[15px] font-bold text-textPrimary">Nothing to prep</h2>
        <p className="mt-1 text-[12px] leading-[1.45] text-textPrimary/60">
          {proDisplayName} hasn&rsquo;t asked for anything ahead of this one. If
          you&rsquo;re unsure about something, just ask.
        </p>
      </section>
    )

  return (
    <div className="flex flex-col gap-3">
      {countdown.tone === 'far' ? (
        <section className="flex items-baseline justify-between gap-3 rounded-card border border-textPrimary/10 bg-surfaceGlass/5 px-4 py-3">
          <span className="text-[19px] font-bold tracking-[-0.03em] text-textPrimary">
            {countdown.label}
          </span>
          <span className="text-right text-[12.5px] text-textPrimary/70 tabular-nums">
            {whenLabel}
          </span>
        </section>
      ) : (
        <section
          className={cn(
            'rounded-card p-4',
            countdown.tone === 'urgent'
              ? 'border border-microAccent bg-microAccent/10'
              : 'border border-textPrimary/10 bg-bgPrimary',
          )}
        >
          <p
            className={cn(
              'font-mono text-[10px] font-bold uppercase tracking-[0.2em]',
              countdown.tone === 'urgent'
                ? 'text-microAccent'
                : 'text-accentPrimary',
            )}
          >
            Your appointment
          </p>
          <p className="mt-2 text-[32px] font-bold leading-[1.05] tracking-[-0.035em] text-textPrimary">
            {countdown.label}
          </p>
          <p className="mt-1 text-[15px] font-semibold text-textPrimary/80 tabular-nums">
            {whenLabel}
          </p>
        </section>
      )}

      {whereBlock}

      {isFar ? (
        <>
          {boardCard}
          {checklistCard}
        </>
      ) : (
        checklistCard
      )}

      {note ? (
        <section className="rounded-card border border-textPrimary/10 bg-bgPrimary p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-textPrimary/45">
            Note from {proDisplayName}
          </p>
          <p className="mt-2 whitespace-pre-line text-[13px] leading-[1.55] text-textPrimary/80">
            {note}
          </p>
        </section>
      ) : null}

      {isFar ? null : boardCard}

      <section className="rounded-card border border-dashed border-textPrimary/20 px-4 py-3">
        <p className="text-[13px] font-semibold text-textPrimary/75">
          After the appointment
        </p>
        <p className="mt-1 text-[12px] leading-[1.5] text-textPrimary/50">
          Your before &amp; after, care plan, payment and rebook window arrive
          here when {proDisplayName} closes out.
        </p>
      </section>
    </div>
  )
}
