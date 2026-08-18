// app/(main)/booking/AvailabilityDrawer/components/DayScroller.test.tsx
//
// A Full day (Tori, 2026-08-18) stays visible in the strip in its real
// calendar position, dimmed and disabled, rather than being skipped.

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import DayScroller from './DayScroller'

const DAYS = [
  {
    ymd: '2026-05-22',
    labelTop: 'Fri',
    labelBottom: '22',
    supplyLabel: '6 open',
    supplyScarce: false,
    disabled: false,
  },
  {
    ymd: '2026-05-23',
    labelTop: 'Sat',
    labelBottom: '23',
    supplyLabel: 'Full',
    supplyScarce: false,
    disabled: true,
  },
  {
    ymd: '2026-05-24',
    labelTop: 'Sun',
    labelBottom: '24',
    supplyLabel: '2 left',
    supplyScarce: true,
    disabled: false,
  },
]

describe('DayScroller', () => {
  it('renders a Full day in its real position, dimmed and disabled', () => {
    render(
      <DayScroller days={DAYS} selectedYMD="2026-05-22" onSelect={vi.fn()} />,
    )

    const fullDay = screen.getByTestId('availability-day-2026-05-23')
    expect(fullDay).toBeDisabled()
    expect(fullDay).toHaveAccessibleName('Sat 23, Full')

    // Still present in its real calendar position between the two open days.
    const allDays = screen.getAllByRole('button')
    expect(allDays.map((el) => el.getAttribute('data-testid'))).toEqual([
      'availability-day-2026-05-22',
      'availability-day-2026-05-23',
      'availability-day-2026-05-24',
    ])
  })

  it('never calls onSelect for a Full day, even on a direct DOM click', () => {
    const onSelect = vi.fn()

    render(
      <DayScroller days={DAYS} selectedYMD="2026-05-22" onSelect={onSelect} />,
    )

    // fireEvent dispatches the click directly, bypassing userEvent's own
    // "disabled elements can't be clicked" guard — proving the disabled
    // button never has an onClick handler bound, not merely that userEvent
    // declined to click it.
    fireEvent.click(screen.getByTestId('availability-day-2026-05-23'))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('still selects an open day normally', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <DayScroller days={DAYS} selectedYMD="2026-05-22" onSelect={onSelect} />,
    )

    await user.click(screen.getByTestId('availability-day-2026-05-24'))

    expect(onSelect).toHaveBeenCalledWith('2026-05-24')
  })
})
