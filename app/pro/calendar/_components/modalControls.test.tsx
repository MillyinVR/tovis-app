// app/pro/calendar/_components/modalControls.test.tsx
//
// The two confirm modals used to carry byte-identical private copies of these
// class strings, `ButtonTone` and the default argument included. Consolidating
// them is only safe while both modals actually render the shared string, so this
// pins it from the rendered DOM rather than from the module's return value —
// a helper can be correct and still not be the one on screen.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { BookingOverrideConfirmModal } from './BookingOverrideConfirmModal'
import { ConfirmChangeModal } from './ConfirmChangeModal'
import {
  calendarModalButtonClassName,
  calendarModalTextareaClassName,
} from './modalControls'

import type { BookingCalendarEvent, PendingMoveChange } from '../_types'
import type { BookingOverridePrompt } from '@/lib/booking/overridePrompts'

const bookingEvent: BookingCalendarEvent = {
  id: 'booking_1',
  kind: 'BOOKING',
  status: 'CONFIRMED',
  startsAt: '2026-06-13T01:00:00.000Z',
  endsAt: '2026-06-13T02:00:00.000Z',
  title: 'Silk press',
  clientName: 'Amara Lewis',
  locationId: 'loc_1',
  locationType: 'SALON',
  timeZone: 'America/Los_Angeles',
  timeZoneSource: 'BOOKING_SNAPSHOT',
  localDateKey: '2026-06-12',
  details: { serviceName: 'Silk press', bufferMinutes: 0, serviceItems: [] },
}

const moveChange: PendingMoveChange = {
  kind: 'move',
  entityType: 'booking',
  eventId: bookingEvent.id,
  apiId: 'b1',
  nextStartIso: '2026-06-13T02:30:00.000Z',
  original: bookingEvent,
}

const overridePrompt: BookingOverridePrompt = {
  code: 'ADVANCE_NOTICE_REQUIRED',
  flag: 'allowShortNotice',
  question: 'Accept this short-notice booking?',
  reasonPlaceholder: 'Optional note for your client',
}

// The SHIPPED strings, written out literally rather than read back from the
// module under test. Asserting `render(...)` carries `calendarModalButton…()`
// compares the helper with itself: perturb the helper and both sides move, so
// the test passes on a restyle it was written to catch. Verified by perturbing
// `tracking-[0.08em]` → `[0.09em]`, which these literals do fail on.
const SHIPPED_BUTTON_BASE =
  'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em] ' +
  'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'
const SHIPPED_BUTTON_PRIMARY =
  'border border-accentPrimary/30 bg-accentPrimary text-ink hover:bg-accentPrimaryHover'
const SHIPPED_BUTTON_GHOST =
  'border border-[var(--line)] bg-transparent text-paperMute hover:bg-paper/5 hover:text-paper'
const SHIPPED_TEXTAREA =
  'w-full resize-none rounded-2xl border border-[var(--line)] bg-ink2 px-3 py-2 ' +
  'text-sm font-semibold text-paper placeholder:text-paperMute ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/** The rendered element's class list, as a Set, for order-independent compare. */
function classesOf(el: Element): Set<string> {
  return new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
}

function expectCarries(el: Element, className: string) {
  const actual = classesOf(el)
  for (const cls of className.split(/\s+/).filter(Boolean)) {
    expect(actual.has(cls), `expected class "${cls}"`).toBe(true)
  }
}

describe('calendar confirm-modal controls', () => {
  it('ConfirmChangeModal renders the shared button and textarea strings', () => {
    render(
      <ConfirmChangeModal
        open
        change={moveChange}
        applying={false}
        outsideWorkingHours
        overrideReason=""
        onChangeOverrideReason={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expectCarries(
      screen.getByRole('button', { name: /save anyway|confirm move/i }),
      `${SHIPPED_BUTTON_BASE} ${SHIPPED_BUTTON_PRIMARY}`,
    )
    expectCarries(
      screen.getByRole('button', { name: /cancel/i }),
      `${SHIPPED_BUTTON_BASE} ${SHIPPED_BUTTON_GHOST}`,
    )
    expectCarries(screen.getByRole('textbox'), SHIPPED_TEXTAREA)
  })

  it('BookingOverrideConfirmModal renders the same shared strings', () => {
    render(
      <BookingOverrideConfirmModal
        open
        prompt={overridePrompt}
        busy={false}
        reason=""
        onChangeReason={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expectCarries(
      screen.getByRole('button', { name: /accept anyway/i }),
      `${SHIPPED_BUTTON_BASE} ${SHIPPED_BUTTON_PRIMARY}`,
    )
    expectCarries(screen.getByRole('textbox'), SHIPPED_TEXTAREA)
  })

  it('the helper itself emits the shipped strings, ghost by default', () => {
    expect(calendarModalButtonClassName('primary')).toBe(
      `${SHIPPED_BUTTON_BASE} ${SHIPPED_BUTTON_PRIMARY}`,
    )
    expect(calendarModalButtonClassName('ghost')).toBe(
      `${SHIPPED_BUTTON_BASE} ${SHIPPED_BUTTON_GHOST}`,
    )
    // Both copies defaulted to 'ghost'; a silent change of default would restyle
    // every call site that passes no argument.
    expect(calendarModalButtonClassName()).toBe(
      calendarModalButtonClassName('ghost'),
    )
    expect(calendarModalTextareaClassName()).toBe(SHIPPED_TEXTAREA)
  })
})
