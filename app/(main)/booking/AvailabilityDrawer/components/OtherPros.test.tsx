import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import OtherPros from './OtherPros'
import type { ProCard, SelectedHold } from '../types'

const slots = [
  '2026-05-22T16:00:00.000Z', // 9:00 AM Pacific
  '2026-05-22T17:00:00.000Z', // 10:00 AM Pacific
  '2026-05-22T18:00:00.000Z', // 11:00 AM Pacific
  '2026-05-22T19:00:00.000Z', // 12:00 PM Pacific
  '2026-05-22T20:00:00.000Z', // 1:00 PM Pacific, hidden by max 4
]

const pro = {
  id: 'pro_1',
  businessName: 'TOVIS Beauty',
  avatarUrl: null,
  isCreator: false,
  distanceMiles: 2.4,
  location: 'Los Angeles, CA',
  locationId: 'loc_1',
  offeringId: 'offering_1',
  timeZone: 'America/Los_Angeles',
  slots,
} satisfies ProCard

function renderOtherPros(args?: {
  others?: ProCard[]
  effectiveServiceId?: string | null
  viewerTz?: string | null
  appointmentTz?: string
  holding?: boolean
  selected?: SelectedHold | null
  onPick?: ReturnType<typeof vi.fn>
  setRef?: ReturnType<typeof vi.fn>
}) {
  const onPick = args?.onPick ?? vi.fn()
  const setRef = args?.setRef ?? vi.fn()

  const effectiveServiceId: string | null =
    args && 'effectiveServiceId' in args
      ? args.effectiveServiceId ?? null
      : 'service_1'

  const result = render(
    <OtherPros
      others={args?.others ?? [pro]}
      effectiveServiceId={effectiveServiceId}
      viewerTz={args?.viewerTz ?? 'America/Los_Angeles'}
      appointmentTz={args?.appointmentTz ?? 'America/Los_Angeles'}
      holding={args?.holding ?? false}
      selected={args?.selected ?? null}
      onPick={onPick}
      setRef={setRef}
    />,
  )

  return {
    ...result,
    onPick,
    setRef,
  }
}

describe('OtherPros', () => {
  it('renders nothing when effectiveServiceId is missing', () => {
    const { container } = renderOtherPros({
      effectiveServiceId: null,
    })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nearby pros with subtitle details', () => {
    renderOtherPros()

    expect(screen.getByTestId('availability-other-pros')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TOVIS Beauty' })).toHaveAttribute(
      'href',
      '/professionals/pro_1',
    )
    expect(screen.getByText('Los Angeles, CA · 2.4 mi')).toBeInTheDocument()
  })

  it('uses Professional as the display fallback when businessName is blank', () => {
    renderOtherPros({
      others: [
        {
          ...pro,
          id: 'pro_blank',
          businessName: '   ',
        },
      ],
    })

    expect(screen.getByRole('link', { name: 'Professional' })).toHaveAttribute(
      'href',
      '/professionals/pro_blank',
    )
  })

  it('only renders the first four visible slots', () => {
    renderOtherPros()

    expect(screen.getByRole('button', { name: /9:00 AM/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /10:00 AM/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /11:00 AM/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /12:00 PM/i })).toBeInTheDocument()

    expect(
      screen.queryByRole('button', {
        name: /1:00 PM/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('calls onPick with pro id, offering id, and raw slot ISO when a slot is clicked', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()

    renderOtherPros({ onPick })

    await user.click(screen.getByRole('button', { name: /9:00 AM/i }))

    expect(onPick).toHaveBeenCalledWith(
      'pro_1',
      'offering_1',
      '2026-05-22T16:00:00.000Z',
    )
  })

  it('disables slot buttons while holding', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()

    renderOtherPros({
      holding: true,
      onPick,
    })

    const slot = screen.getByRole('button', { name: /9:00 AM/i })

    expect(slot).toBeDisabled()

    await user.click(slot)

    expect(onPick).not.toHaveBeenCalled()
  })

  it('disables slot buttons when the pro has no offering id', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()

    renderOtherPros({
      onPick,
      others: [
        {
          ...pro,
          offeringId: null,
        },
      ],
    })

    const slot = screen.getByRole('button', { name: /9:00 AM/i })

    expect(slot).toBeDisabled()

    await user.click(slot)

    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows empty copy for a pro with no visible slots', () => {
    renderOtherPros({
      others: [
        {
          ...pro,
          slots: [],
        },
      ],
    })

    expect(
      screen.getByText('No available times for this day.'),
    ).toBeInTheDocument()
  })

  it('shows fallback empty copy when no nearby pros are passed', () => {
    renderOtherPros({
      others: [],
    })

    expect(screen.getByText('No similar pros found nearby.')).toBeInTheDocument()
  })

  it('shows timezone hint when viewer timezone differs from pro timezone', () => {
    renderOtherPros({
      viewerTz: 'America/New_York',
      others: [
        {
          ...pro,
          timeZone: 'America/Los_Angeles',
        },
      ],
    })

    expect(
      screen.getByText('Los Angeles, CA · 2.4 mi · America/Los_Angeles'),
    ).toBeInTheDocument()
  })
})