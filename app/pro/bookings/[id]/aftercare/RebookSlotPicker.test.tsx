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
    const slotButton = await screen.findByRole('button', { name: '5:00 PM' })
    fireEvent.click(slotButton)

    expect(onChange).toHaveBeenCalledWith({
      offeringId: 'off_1',
      locationId: 'loc_1',
      locationType: 'SALON',
      // Salon slots never carry a client address, even if one was passed in.
      clientAddressId: null,
      startsAt: '2026-07-01T17:00:00.000Z',
      endsAt: '2026-07-01T18:00:00.000Z',
    } satisfies SelectedRebookSlot)
  })

  it('emits the mobile client address the availability was computed for', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        slots: ['2026-07-01T17:00:00.000Z'],
        durationMinutes: 90,
      }),
    )

    const onChange = vi.fn()
    const { container } = render(
      <RebookSlotPicker
        {...BASE_PROPS}
        locationType="MOBILE"
        clientAddressId="addr_1"
        onChange={onChange}
      />,
    )

    const dayInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-07-01' } })

    // Mobile availability is travel-aware: the address rides the query…
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'clientAddressId=addr_1',
    )

    // …and the emitted slot carries the same address, so the saved proposal
    // can never disagree with the availability it came from.
    const slotButton = await screen.findByRole('button', { name: '5:00 PM' })
    fireEvent.click(slotButton)

    expect(onChange).toHaveBeenCalledWith({
      offeringId: 'off_1',
      locationId: 'loc_1',
      locationType: 'MOBILE',
      clientAddressId: 'addr_1',
      startsAt: '2026-07-01T17:00:00.000Z',
      endsAt: '2026-07-01T18:30:00.000Z',
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

  it('names the off day and points at Custom time when the empty day is outside working hours', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, slots: [], durationMinutes: 60 }),
    )

    const { container } = render(
      <RebookSlotPicker
        {...BASE_PROPS}
        // 2026-07-01 is a Wednesday (weekday index 3).
        offWeekdays={new Set([3])}
        onChange={vi.fn()}
      />,
    )

    const dayInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-07-01' } })

    expect(
      await screen.findByText(
        /outside your working hours — switch to Custom time/i,
      ),
    ).toBeInTheDocument()
  })

  it('emits a custom slot composed from the picked day + typed time, sized by the offering duration', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/availability/day')) {
        return jsonResponse(200, { ok: true, slots: [], durationMinutes: 90 })
      }
      return jsonResponse(200, { events: [] })
    })

    const onChange = vi.fn()
    const { container } = render(
      <RebookSlotPicker {...BASE_PROPS} onChange={onChange} />,
    )

    const dayInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-07-01' } })

    // Wait for the availability fetch so durationMinutes (90) is in state.
    expect(await screen.findByText(/no open times/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Custom time' }))

    const timeInput = container.querySelector(
      'input[type="time"]',
    ) as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '07:30' } })

    // The emitted slot is the wall time in the location zone (UTC here) with
    // the offering's real width — not a slot the public grid offered.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        offeringId: 'off_1',
        locationId: 'loc_1',
        locationType: 'SALON',
        clientAddressId: null,
        startsAt: '2026-07-01T07:30:00.000Z',
        endsAt: '2026-07-01T09:00:00.000Z',
      } satisfies SelectedRebookSlot)
    })
  })

  it('warns (but still allows) when the custom time overlaps an existing commitment', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/availability/day')) {
        return jsonResponse(200, { ok: true, slots: [], durationMinutes: 60 })
      }
      if (url.includes('/api/v1/pro/calendar')) {
        return jsonResponse(200, {
          events: [
            {
              id: 'booking_9',
              kind: 'BOOKING',
              startsAt: '2026-07-01T07:00:00.000Z',
              endsAt: '2026-07-01T08:00:00.000Z',
              clientName: 'Ana',
            },
          ],
        })
      }
      return jsonResponse(200, { ok: true })
    })

    const onChange = vi.fn()
    const { container } = render(
      <RebookSlotPicker {...BASE_PROPS} onChange={onChange} />,
    )

    const dayInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement
    fireEvent.change(dayInput, { target: { value: '2026-07-01' } })

    fireEvent.click(screen.getByRole('button', { name: 'Custom time' }))

    const timeInput = container.querySelector(
      'input[type="time"]',
    ) as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '07:30' } })

    // The overlap note names the colliding client but the pick still stands.
    expect(await screen.findByText(/This overlaps Ana/i)).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ startsAt: '2026-07-01T07:30:00.000Z' }),
    )
  })
})
