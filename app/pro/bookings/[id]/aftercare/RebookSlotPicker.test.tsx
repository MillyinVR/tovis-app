import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import RebookSlotPicker, { type SelectedRebookSlot } from './RebookSlotPicker'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const BASE_PROPS = {
  professionalId: 'pro_1',
  serviceId: 'svc_1',
  offeringId: 'off_1',
  locationType: 'SALON' as const,
  locationId: 'loc_1',
  clientAddressId: null,
  timeZone: 'UTC',
  minYmd: '2026-06-23',
  value: null,
  disabled: false,
}

describe('RebookSlotPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows a notice and proposes nothing when the booking has no offering', () => {
    const onChange = vi.fn()
    render(
      <RebookSlotPicker {...BASE_PROPS} offeringId={null} onChange={onChange} />,
    )

    expect(screen.getByText(/service offering/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/available times/i),
    ).not.toBeInTheDocument()
  })

  it('loads availability for the picked day and emits a slot with a computed end time', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        slots: ['2026-07-01T17:00:00.000Z'],
        durationMinutes: 60,
      }),
    )

    const onChange = vi.fn()
    const { container } = render(
      <RebookSlotPicker {...BASE_PROPS} onChange={onChange} />,
    )

    const dayInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-07-01' } })

    // It queried the pro's availability with the source booking's offering/location.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('/api/v1/availability/day?')
    expect(url).toContain('professionalId=pro_1')
    expect(url).toContain('serviceId=svc_1')
    expect(url).toContain('locationType=SALON')
    expect(url).toContain('locationId=loc_1')
    expect(url).toContain('date=2026-07-01')

    // The available time renders as a button; picking it emits the full slot.
    const slotButton = await screen.findByRole('button')
    fireEvent.click(slotButton)

    expect(onChange).toHaveBeenCalledWith({
      offeringId: 'off_1',
      locationId: 'loc_1',
      locationType: 'SALON',
      startsAt: '2026-07-01T17:00:00.000Z',
      endsAt: '2026-07-01T18:00:00.000Z',
    } satisfies SelectedRebookSlot)
  })

  it('shows a fallback when the day has no open times', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, slots: [], durationMinutes: 60 }),
    )

    const { container } = render(
      <RebookSlotPicker {...BASE_PROPS} onChange={vi.fn()} />,
    )

    const dayInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-07-01' } })

    expect(await screen.findByText(/no open times/i)).toBeInTheDocument()
  })
})
