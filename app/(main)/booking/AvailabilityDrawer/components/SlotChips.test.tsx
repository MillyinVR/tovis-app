// app/(main)/booking/AvailabilityDrawer/components/SlotChips.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import SlotChips from './SlotChips'
import type { ProCard, SelectedHold } from '../types'

const pro = {
  id: 'pro_1',
  businessName: 'TOVIS Beauty',
  avatarUrl: null,
  isCreator: false,
  distanceMiles: null,
  location: 'Los Angeles, CA',
  locationId: 'loc_1',
  offeringId: 'offering_1',
} satisfies ProCard

function renderSlotChips(args?: {
  slotsForDay?: string[]
  period?: 'MORNING' | 'AFTERNOON' | 'EVENING'
  holding?: boolean
  selected?: SelectedHold | null
  onPick?: ReturnType<typeof vi.fn>
  onSelectPeriod?: ReturnType<typeof vi.fn>
}) {
  const onPick = args?.onPick ?? vi.fn()
  const onSelectPeriod = args?.onSelectPeriod ?? vi.fn()

  render(
    <SlotChips
      pro={pro}
      appointmentTz="America/Los_Angeles"
      holding={args?.holding ?? false}
      selected={args?.selected ?? null}
      period={args?.period ?? 'MORNING'}
      onSelectPeriod={onSelectPeriod}
      slotsForDay={
        args?.slotsForDay ?? [
          '2026-05-22T16:00:00.000Z', // 9:00 AM Pacific
          '2026-05-22T20:00:00.000Z', // 1:00 PM Pacific
          '2026-05-23T01:00:00.000Z', // 6:00 PM Pacific
        ]
      }
      onPick={onPick}
    />,
  )

  return {
    onPick,
    onSelectPeriod,
  }
}

describe('SlotChips', () => {
  it('renders only slots for the active period and picks the selected ISO slot', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()

    renderSlotChips({
      period: 'MORNING',
      onPick,
    })

    const morningSlot = screen.getByRole('button', {
      name: /9:00 AM/i,
    })

    expect(morningSlot).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /1:00 PM/i,
      }),
    ).not.toBeInTheDocument()

    await user.click(morningSlot)

    expect(onPick).toHaveBeenCalledWith(
      'pro_1',
      'offering_1',
      '2026-05-22T16:00:00.000Z',
    )
  })

  it('changes period through the period buttons', async () => {
    const user = userEvent.setup()
    const onSelectPeriod = vi.fn()

    renderSlotChips({
      period: 'MORNING',
      onSelectPeriod,
    })

    await user.click(screen.getByTestId('availability-period-afternoon'))

    expect(onSelectPeriod).toHaveBeenCalledWith('AFTERNOON')
  })

  it('disables period buttons that have no slots', () => {
    renderSlotChips({
      period: 'MORNING',
      slotsForDay: ['2026-05-22T16:00:00.000Z'],
    })

    expect(screen.getByTestId('availability-period-morning')).not.toBeDisabled()
    expect(screen.getByTestId('availability-period-afternoon')).toBeDisabled()
    expect(screen.getByTestId('availability-period-evening')).toBeDisabled()
  })

  it('shows an empty message when the selected period has no slots', () => {
    renderSlotChips({
      period: 'AFTERNOON',
      slotsForDay: ['2026-05-22T16:00:00.000Z'],
    })

    expect(
      screen.getByText('No afternoon times for this day.'),
    ).toBeInTheDocument()
  })

  it('dedupes duplicate slots before rendering', () => {
    renderSlotChips({
      period: 'MORNING',
      slotsForDay: [
        '2026-05-22T16:00:00.000Z',
        '2026-05-22T16:00:00.000Z',
      ],
    })

    expect(
      screen.getAllByRole('button', {
        name: /9:00 AM/i,
      }),
    ).toHaveLength(1)
  })

  it('does not expose the raw slot ISO in test ids', () => {
    const slotISO = '2026-05-22T16:00:00.000Z'

    renderSlotChips({
      period: 'MORNING',
      slotsForDay: [slotISO],
    })

    expect(screen.getByTestId('availability-slot-0')).toBeInTheDocument()
    expect(screen.queryByTestId(`availability-slot-${slotISO}`)).toBeNull()
  })

  it('disables slot selection while a hold request is in progress', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()

    renderSlotChips({
      period: 'MORNING',
      holding: true,
      onPick,
    })

    const slot = screen.getByRole('button', {
      name: /9:00 AM/i,
    })

    expect(slot).toBeDisabled()

    await user.click(slot)

    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText('Holding your time…')).toBeInTheDocument()
  })
})