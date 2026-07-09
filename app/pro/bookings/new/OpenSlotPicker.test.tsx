import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import OpenSlotPicker from './OpenSlotPicker'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const baseProps = {
  professionalId: 'pro_1',
  serviceId: 'svc_1',
  offeringId: 'off_1',
  locationId: 'loc_1',
  locationType: 'SALON' as const,
  locationTimeZone: 'America/New_York',
}

describe('OpenSlotPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('fetches the day availability with the right query params and renders slot buttons', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        slots: ['2026-07-10T14:00:00.000Z', '2026-07-10T14:30:00.000Z'],
        timeZone: 'America/New_York',
      }),
    )

    const onChange = vi.fn()
    render(<OpenSlotPicker {...baseProps} value={null} onChange={onChange} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://x')
    expect(url.pathname).toBe('/api/v1/availability/day')
    expect(url.searchParams.get('professionalId')).toBe('pro_1')
    expect(url.searchParams.get('serviceId')).toBe('svc_1')
    expect(url.searchParams.get('locationType')).toBe('SALON')
    expect(url.searchParams.get('locationId')).toBe('loc_1')
    expect(url.searchParams.get('date')).toBeTruthy()
    // SALON booking never scopes slots to a client address.
    expect(url.searchParams.get('clientAddressId')).toBeNull()

    // Two slot buttons render (aria-pressed marks the toggle role).
    await waitFor(() => {
      const pressables = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') !== null)
      expect(pressables).toHaveLength(2)
    })
  })

  it('calls onChange with the chosen slot ISO instant on click', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        slots: ['2026-07-10T14:00:00.000Z'],
        timeZone: 'America/New_York',
      }),
    )

    const onChange = vi.fn()
    render(<OpenSlotPicker {...baseProps} value={null} onChange={onChange} />)

    const slotButton = await screen.findByRole('button', {
      // 14:00Z = 10:00 AM in America/New_York (EDT).
      name: /10:00/,
    })
    fireEvent.click(slotButton)

    expect(onChange).toHaveBeenCalledWith('2026-07-10T14:00:00.000Z')
    // The fetch effect also clears any prior selection with null on load.
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('passes selected add-on ids so slots reserve the full duration', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, slots: [], timeZone: 'America/New_York' }),
    )

    render(
      <OpenSlotPicker
        {...baseProps}
        addOnIds={['oa_1', 'oa_2']}
        value={null}
        onChange={vi.fn()}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://x')
    expect(url.searchParams.get('addOnIds')).toBe('oa_1,oa_2')
  })

  it('omits the addOnIds param when none are selected', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, slots: [], timeZone: 'America/New_York' }),
    )

    render(<OpenSlotPicker {...baseProps} value={null} onChange={vi.fn()} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://x')
    expect(url.searchParams.get('addOnIds')).toBeNull()
  })

  it('scopes MOBILE slots to the client address when provided', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, slots: [], timeZone: 'America/New_York' }),
    )

    render(
      <OpenSlotPicker
        {...baseProps}
        locationType="MOBILE"
        clientAddressId="addr_1"
        value={null}
        onChange={vi.fn()}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://x')
    expect(url.searchParams.get('locationType')).toBe('MOBILE')
    expect(url.searchParams.get('clientAddressId')).toBe('addr_1')
  })

  it('surfaces the endpoint error message on a failed load', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(400, { ok: false, error: 'You can book up to 30 days in advance.' }),
    )

    render(<OpenSlotPicker {...baseProps} value={null} onChange={vi.fn()} />)

    expect(
      await screen.findByText('You can book up to 30 days in advance.'),
    ).toBeInTheDocument()
  })

  it('shows an empty-day hint when there are no open slots', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: true, slots: [], timeZone: 'America/New_York' }),
    )

    render(<OpenSlotPicker {...baseProps} value={null} onChange={vi.fn()} />)

    expect(await screen.findByText(/No open times on this day/i)).toBeInTheDocument()
  })
})
