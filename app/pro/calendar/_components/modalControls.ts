// app/pro/calendar/_components/modalControls.ts
//
// The calendar's confirm-modal button and textarea, in one place. Both class
// strings — and the `CalendarModalTone` union with them — were byte-identical
// copies in `BookingOverrideConfirmModal` and `ConfirmChangeModal`, right down to
// the default argument.
//
// These deliberately do NOT go through `@/app/_components/ui`. The calendar
// speaks its own language: a mono, uppercase, letter-spaced button on the
// `--line` / `paper` / `ink` palette, which is a different visual system from the
// kit's `Button`, not a drifted copy of it. Migrating it onto the kit would be a
// restyle of the calendar, which is a decision, not a cleanup. The duplication
// between the two modals is the part that was simply a duplicate — that is what
// this file removes.
//
// Named `calendar…ClassName` rather than `buttonClassName` on purpose: the kit
// exports a `buttonClassName`, and a private declaration sharing that name is
// exactly what `check:no-private-lib-fork` flags. A distinct name says "different
// system" to the guard and to the next reader alike.

export type CalendarModalTone = 'primary' | 'ghost'

/** The calendar confirm modals' button. */
export function calendarModalButtonClassName(
  tone: CalendarModalTone = 'ghost',
): string {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-ink hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-transparent text-paperMute',
    'hover:bg-paper/5 hover:text-paper',
  ].join(' ')
}

/** The note field those same modals put above the button row. */
export function calendarModalTextareaClassName(): string {
  return [
    'w-full resize-none rounded-2xl border border-[var(--line)] bg-ink2 px-3 py-2',
    'text-sm font-semibold text-paper placeholder:text-paperMute',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
}
