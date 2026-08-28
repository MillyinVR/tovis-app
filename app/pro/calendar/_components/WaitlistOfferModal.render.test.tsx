// app/pro/calendar/_components/WaitlistOfferModal.render.test.tsx
//
// Drives the RENDERED modal, not just its types.
//
// The bug class this exists for: the modal used to be handed a salon location by
// the calendar and send `locationType: 'SALON'` as a literal, so "can this pro
// offer a mobile time?" was answered on the device — wrongly, and silently. It
// now asks the server. A test on the DTO alone would pass just as happily if the
// mode buttons were never rendered, or rendered with no handler, so this clicks
// the control and reads what the POST carries.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  slotPickerProps: { current: null as null | Record<string, unknown> },
}))

// The picker itself is driven by its own suites; here it stands in as a probe on
// what this modal ASKS it for — which for a mobile offer must be the entry id and
// never a client address.
vi.mock('@/app/pro/bookings/[id]/aftercare/RebookSlotPicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mocks.slotPickerProps.current = props
    return (
      <button
        type="button"
        onClick={() =>
          (props.onChange as (slot: unknown) => void)({
            offeringId: 'off_1',
            locationId: props.locationId,
            locationType: props.locationType,
            clientAddressId: null,
            startsAt: '2026-09-01T17:00:00.000Z',
            endsAt: '2026-09-01T18:00:00.000Z',
          })
        }
      >
        pick a slot
      </button>
    )
  },
}))

import WaitlistOfferModal from './WaitlistOfferModal'

const BOTH_MODES = {
  ok: true,
  offeringId: 'off_1',
  blockedReason: null,
  options: [
    {
      locationType: 'SALON',
      locationId: 'loc_1',
      locationName: 'Main Salon',
      timeZone: 'America/Los_Angeles',
      durationMinutes: 60,
    },
    {
      locationType: 'MOBILE',
      locationId: 'base_1',
      locationName: 'Home base',
      timeZone: 'America/Los_Angeles',
      durationMinutes: 75,
    },
  ],
}

function renderModal() {
  return render(
    <WaitlistOfferModal
      open
      onClose={() => {}}
      professionalId="pro_1"
      waitlistEntryId="wle_1"
      serviceId="svc_1"
      fallbackTimeZone="America/Los_Angeles"
      clientName="Nadia"
      serviceName="Balayage"
      onOffered={() => {}}
    />,
  )
}

/** A fetch stub: the options GET, then whatever the POST should answer. */
function stubFetch(options: unknown, postResponse?: { ok: boolean }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return {
        ok: postResponse?.ok ?? true,
        status: postResponse?.ok === false ? 409 : 201,
        json: async () => ({ ok: postResponse?.ok ?? true }),
      }
    }
    return { ok: true, status: 200, json: async () => options }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('WaitlistOfferModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.slotPickerProps.current = null
  })

  it('renders a mode control from the SERVER’s options, not a local guess', async () => {
    stubFetch(BOTH_MODES)
    renderModal()

    // Named from the option's own location name / mode, so a pro with two salons
    // can tell them apart.
    await screen.findByRole('radio', { name: 'Main Salon' })
    expect(screen.getByRole('radio', { name: 'Mobile' })).toBeTruthy()
  })

  it('offers MOBILE ALONE to a pro who can only travel — the case that used to render nothing', async () => {
    stubFetch({ ...BOTH_MODES, options: [BOTH_MODES.options[1]] })
    renderModal()

    // One option means no toggle to render; what matters is that the picker is
    // live and pointed at the mobile base. Before this change the calendar never
    // opened this modal for such a pro at all.
    await waitFor(() => {
      expect(mocks.slotPickerProps.current?.locationType).toBe('MOBILE')
    })
    expect(mocks.slotPickerProps.current?.locationId).toBe('base_1')
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('asks availability by ENTRY ID and never by client address', async () => {
    stubFetch({ ...BOTH_MODES, options: [BOTH_MODES.options[1]] })
    renderModal()

    await waitFor(() => {
      expect(mocks.slotPickerProps.current).toBeTruthy()
    })
    // 🔴 The privacy boundary as the UI expresses it: the destination is the
    // server's business, and this component has no address to pass even if a
    // future edit wanted to.
    expect(mocks.slotPickerProps.current?.waitlistEntryId).toBe('wle_1')
    expect(mocks.slotPickerProps.current?.clientAddressId).toBeNull()
  })

  it('sends the SELECTED mode and its own location', async () => {
    const fetchMock = stubFetch(BOTH_MODES)
    renderModal()

    fireEvent.click(await screen.findByRole('radio', { name: 'Mobile' }))
    fireEvent.click(screen.getByText('pick a slot'))
    fireEvent.click(screen.getByText('Send offer'))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(true)
    })

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>

    expect(body.locationType).toBe('MOBILE')
    expect(body.locationId).toBe('base_1')
    // And no destination — the write boundary resolves it.
    expect(body.clientAddressId).toBeUndefined()
  })

  it('drops a slot picked in the OTHER mode when the pro switches', async () => {
    stubFetch(BOTH_MODES)
    renderModal()

    fireEvent.click(await screen.findByText('pick a slot'))
    await waitFor(() => {
      expect(
        (screen.getByText('Send offer') as HTMLButtonElement).disabled,
      ).toBe(false)
    })

    // A slot's availability was computed for one mode's location and travel
    // radius; carrying it across would offer a time the other mode never had.
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile' }))
    expect((screen.getByText('Send offer') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('paints the SERVER’s blocked sentence, with no picker and no send', async () => {
    stubFetch({
      ok: true,
      offeringId: null,
      options: [],
      blockedReason:
        'You don’t have an active offering for this service, so there’s no time to offer. Add or activate the service first.',
    })
    renderModal()

    await screen.findByText(/don’t have an active offering/)
    expect(screen.queryByText('pick a slot')).toBeNull()
    expect((screen.getByText('Send offer') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('tells the pro a mobile offer means travelling to the client', async () => {
    stubFetch({ ...BOTH_MODES, options: [BOTH_MODES.options[1]] })
    renderModal()

    // The pro is choosing a time for a trip whose address they cannot see yet;
    // the sentence is what explains the missing address rather than leaving it
    // looking like an oversight.
    await screen.findByText(/You’ll travel to Nadia/)
  })
})
