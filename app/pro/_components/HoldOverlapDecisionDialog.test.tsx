// app/pro/_components/HoldOverlapDecisionDialog.test.tsx
//
// The pro's live-hold decision, as rendered (Tori, 2026-08-28).
//
// Two things are pinned here, and the second matters more than the first.
//
// 1. The dialog says what the pro needs to decide: new or returning to THEM,
//    which service, which time, and the same mm:ss the client is watching.
// 2. It says NOTHING ELSE about the person. That is asserted as an ABSENCE —
//    the fixture carries a name, an email, a phone and an avatar URL in the
//    props' neighbourhood, and none of them may reach the DOM. Checking that
//    the visible text is correct would pass just as happily on a dialog that
//    also printed the client's name underneath.

import { render, screen, act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HeldSlotDecision } from '@/lib/booking/holdOverlapPrompt'
import { HoldOverlapDecisionDialog } from './HoldOverlapDecisionDialog'

const NOW = new Date('2026-09-01T18:30:00.000Z')
const TIME_ZONE = 'America/Los_Angeles'

/**
 * The identity of the client behind the hold. NONE of this is a prop the dialog
 * accepts — that is the point: if a later change widened `HeldSlotDecision`,
 * these are the strings that would start showing up.
 */
const HELD_CLIENT = {
  name: 'Marguerite Okonkwo',
  firstName: 'Marguerite',
  email: 'marguerite.okonkwo@example.com',
  phone: '+15558675309',
  avatarUrl: 'https://cdn.example.com/avatars/marguerite.jpg',
  clientId: 'client_marguerite_1',
}

function decisionFixture(
  overrides: Partial<HeldSlotDecision> = {},
): HeldSlotDecision {
  return {
    holdId: 'hold_1',
    relationship: 'RETURNING',
    serviceName: 'Signature Manicure',
    startsAt: '2026-09-01T19:00:00.000Z',
    endsAt: '2026-09-01T20:15:00.000Z',
    // 7:42 from the frozen clock.
    expiresAt: new Date(NOW.getTime() + 7 * 60_000 + 42_000).toISOString(),
    additionalHeldSlots: 0,
    ...overrides,
  }
}

function renderDialog(args?: {
  decision?: HeldSlotDecision | null
  intent?: 'create' | 'edit'
  busy?: boolean
  onProceed?: () => void
  onWait?: () => void
}) {
  return render(
    <HoldOverlapDecisionDialog
      decision={args?.decision === undefined ? decisionFixture() : args.decision}
      intent={args?.intent ?? 'create'}
      timeZone={TIME_ZONE}
      busy={args?.busy ?? false}
      onProceed={args?.onProceed ?? (() => {})}
      onWait={args?.onWait ?? (() => {})}
    />,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HoldOverlapDecisionDialog — what it says', () => {
  it('renders nothing when there is no decision to answer', () => {
    const { container } = renderDialog({ decision: null })

    expect(container.textContent).toBe('')
  })

  it.each([
    ['RETURNING' as const, 'A returning client is booking'],
    ['NEW' as const, 'A new client is booking'],
    // A hold with no client at all — "new" would be an invention.
    ['UNKNOWN' as const, 'A client is booking'],
  ])('leads with the %s label', (relationship, leadIn) => {
    renderDialog({ decision: decisionFixture({ relationship }) })

    expect(screen.getByTestId('hold-overlap-summary').textContent).toContain(
      leadIn,
    )
  })

  it('names the service and the slot, in the booking location’s zone', () => {
    renderDialog()

    const summary = screen.getByTestId('hold-overlap-summary').textContent ?? ''

    expect(summary).toContain('Signature Manicure')
    // 19:00Z is 12:00 PM in Los Angeles — the pro's day, not the server's.
    expect(summary).toContain('12:00 PM')
  })

  it('shows the same mm:ss the client is watching, and ticks', () => {
    renderDialog()

    expect(screen.getByTestId('hold-overlap-countdown').textContent).toBe(
      '07:42',
    )

    act(() => {
      vi.advanceTimersByTime(62_000)
    })

    expect(screen.getByTestId('hold-overlap-countdown').textContent).toBe(
      '06:40',
    )
  })

  // The pro is mid-decision. A dialog that vanished under their cursor would
  // leave them wondering what they had just clicked — so it stays and says the
  // minutes are free again.
  it('says the checkout lapsed rather than disappearing', () => {
    renderDialog({
      decision: decisionFixture({
        expiresAt: new Date(NOW.getTime() + 20_000).toISOString(),
      }),
    })

    act(() => {
      vi.advanceTimersByTime(21_000)
    })

    expect(screen.queryByTestId('hold-overlap-countdown')).toBeNull()
    expect(screen.getByTestId('hold-overlap-decision').textContent).toContain(
      'Their checkout just ran out',
    )
  })

  it('counts further held slots instead of implying a single client', () => {
    renderDialog({ decision: decisionFixture({ additionalHeldSlots: 2 }) })

    expect(screen.getByTestId('hold-overlap-decision').textContent).toContain(
      '2 more clients are checking out',
    )
  })

  it('says nothing about extra slots when there are none', () => {
    renderDialog()

    expect(
      screen.getByTestId('hold-overlap-decision').textContent,
    ).not.toContain('more client')
  })

  it('changes the action wording between booking and rescheduling', () => {
    const { unmount } = renderDialog({ intent: 'create' })
    expect(screen.getByText('Book it anyway')).toBeTruthy()
    unmount()

    renderDialog({ intent: 'edit' })
    expect(screen.getByText('Move it here anyway')).toBeTruthy()
  })
})

// 🔴 The load-bearing suite. Asserting the visible text is right proves nothing
// about what else is on the screen.
describe('HoldOverlapDecisionDialog — what it must never say', () => {
  it.each([
    ['a name', HELD_CLIENT.name],
    ['a first name', HELD_CLIENT.firstName],
    ['an email', HELD_CLIENT.email],
    ['a phone number', HELD_CLIENT.phone],
    ['a client id', HELD_CLIENT.clientId],
  ])('never renders %s', (_label, secret) => {
    const { container } = renderDialog()

    expect(container.textContent ?? '').not.toContain(secret)
    // Not in an attribute either — a title/aria-label is still a leak.
    expect(container.innerHTML).not.toContain(secret)
  })

  it('renders no avatar or image of any kind', () => {
    const { container } = renderDialog()

    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.innerHTML).not.toContain(HELD_CLIENT.avatarUrl)
    expect(container.innerHTML).not.toContain('avatar')
  })

  // The dialog's ONLY input about the person is a three-value enum, so there is
  // nothing to leak even under a hostile payload: a `serviceName` is the pro's
  // own catalog text, and everything else is an instant or a count.
  it('cannot be made to render identity through its own props', () => {
    const { container } = renderDialog({
      decision: {
        ...decisionFixture(),
        // Only reachable if someone widened the type; the guard is that the
        // component has no field to put it in.
        ...({ clientName: HELD_CLIENT.name } as Partial<HeldSlotDecision>),
      },
    })

    expect(container.innerHTML).not.toContain(HELD_CLIENT.name)
  })

  it('says out loud that the label is all the pro gets', () => {
    renderDialog()

    expect(screen.getByTestId('hold-overlap-decision').textContent).toContain(
      'We only say new or returning while a checkout is in progress',
    )
  })
})

describe('HoldOverlapDecisionDialog — both button paths', () => {
  it('proceeds when the pro chooses to book anyway', () => {
    const onProceed = vi.fn()
    const onWait = vi.fn()

    renderDialog({ onProceed, onWait })
    fireEvent.click(screen.getByText('Book it anyway'))

    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(onWait).not.toHaveBeenCalled()
  })

  it('aborts when the pro chooses to wait', () => {
    const onProceed = vi.fn()
    const onWait = vi.fn()

    renderDialog({ onProceed, onWait })
    fireEvent.click(screen.getByText('Wait for them'))

    expect(onWait).toHaveBeenCalledTimes(1)
    expect(onProceed).not.toHaveBeenCalled()
  })

  // Escape and the backdrop are the same answer as "wait": the destructive
  // choice here is taking somebody's slot, so it must never be the accident.
  it.each([
    [
      'escape',
      () => fireEvent.keyDown(window, { key: 'Escape' }),
    ],
    [
      'a backdrop click',
      () => fireEvent.mouseDown(screen.getByTestId('hold-overlap-decision')),
    ],
  ])('treats %s as waiting, never as proceeding', (_label, act_) => {
    const onProceed = vi.fn()
    const onWait = vi.fn()

    renderDialog({ onProceed, onWait })
    act_()

    expect(onWait).toHaveBeenCalledTimes(1)
    expect(onProceed).not.toHaveBeenCalled()
  })

  it('ignores dismissal while a submit is in flight', () => {
    const onWait = vi.fn()

    renderDialog({ busy: true, onWait })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByTestId('hold-overlap-decision'))

    expect(onWait).not.toHaveBeenCalled()
  })

  it('disables both buttons while a submit is in flight', () => {
    renderDialog({ busy: true })

    expect(
      screen.getByText('Book it anyway').hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByText('Wait for them').hasAttribute('disabled')).toBe(
      true,
    )
  })
})
