// app/pro/migrate/services/MigrateServicesClient.test.tsx
//
// W6 on the WIRE, for the web service-menu import.
//
// The wizard hardcoded `offersInSalon: true` / `offersMobile: false` in two
// places — the row builder and the commit payload — so a mobile-only pro's
// entire imported menu was written as in-salon, advertising a booking they
// cannot host. It had to hardcode them, because the commit route parsed an
// absent flag as `false` and refused the row NO_MODE.
//
// These drive the real component through upload → preview → commit and assert
// the BODY it actually posts, because that body is the only thing the server
// sees. Its iOS twin is `unstatedModesAreOmittedFromTheCommitBody`
// (tovis-ios TovisKitTests/ProMigrationServiceImportTests.swift), and the
// server half is tests/integration/service-import-location-modes.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { defaultMigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import { isRecord } from '@/lib/guards'

// The wizard parses the spreadsheet in the browser before it ever calls the
// API. Stubbed so these tests are about the payload, not about xlsx parsing.
vi.mock('../_utils/parseSpreadsheetFile', () => ({
  parseSpreadsheetFiles: async () => ({
    ok: true,
    tables: [
      {
        headers: ['Service', 'Price', 'Duration'],
        rows: [{ Service: 'Silk Press', Price: '140', Duration: '90' }],
      },
    ],
  }),
}))

import { MigrateServicesClient } from './MigrateServicesClient'

const COPY = defaultMigrationCopy('Tovis').services

const CATALOG = [
  {
    id: 'svc_press',
    name: 'Silk Press',
    categoryName: 'Hair',
    minPrice: 100,
    defaultDurationMinutes: 90,
    allowMobile: true,
  },
]

const ROWS = [
  {
    index: 0,
    sourceName: 'Silk Press',
    sourcePrice: 140,
    sourceDurationMinutes: 90,
    suggestions: [
      { serviceId: 'svc_press', name: 'Silk Press', categoryName: 'Hair', score: 98 },
    ],
    bestServiceId: 'svc_press',
  },
]

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The preview payload for a pro the server derived `modes` for. */
function previewBody(modes: { offersInSalon: boolean; offersMobile: boolean } | null) {
  return {
    ok: true,
    catalog: CATALOG,
    rows: ROWS,
    ...(modes
      ? {
          locationCapability: { salon: modes.offersInSalon, mobile: modes.offersMobile },
          defaultOfferingModes: modes,
        }
      : {}),
  }
}

const COMMIT_OK = {
  ok: true,
  rows: [{ serviceId: 'svc_press', ok: true, offeringId: 'off_1', ramps: 0 }],
  summary: { attempted: 1, created: 1, skipped: 0, rampsCreated: 0 },
}

/**
 * Drive upload → preview → commit and hand back the decision the wizard posted.
 */
async function runImport(
  modes: { offersInSalon: boolean; offersMobile: boolean } | null,
): Promise<Record<string, unknown>> {
  const fetchMock = vi.mocked(fetch)
  fetchMock
    .mockResolvedValueOnce(jsonResponse(previewBody(modes)))
    .mockResolvedValueOnce(jsonResponse(COMMIT_OK))

  render(<MigrateServicesClient copy={COPY} />)

  const input = document.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input')
  fireEvent.change(input, {
    target: { files: [new File([''], 'menu.csv', { type: 'text/csv' })] },
  })

  // Preview landed and the wizard moved to the map step.
  await waitFor(() => expect(screen.getByText(/will be added/i)).toBeTruthy())

  fireEvent.click(screen.getByRole('button', { name: new RegExp(COPY.addBtn, 'i') }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

  const [url, init] = fetchMock.mock.calls[1] ?? []
  expect(String(url)).toBe('/api/v1/pro/migrate/services/commit')
  const parsed: unknown = JSON.parse(String(init?.body))
  if (!isRecord(parsed) || !Array.isArray(parsed.decisions)) {
    throw new Error('commit body had no decisions')
  }
  const decision: unknown = parsed.decisions[0]
  if (!isRecord(decision)) throw new Error('decision was not an object')
  return decision
}

describe('MigrateServicesClient commit payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('states NEITHER mode, so the route derives them', async () => {
    const decision = await runImport({ offersInSalon: false, offersMobile: true })

    // The fix. `in`, not a truthiness check: a hardcoded `false` is exactly what
    // this used to send, and it is a STATED choice the route obeys.
    expect('offersInSalon' in decision).toBe(false)
    expect('offersMobile' in decision).toBe(false)
  })

  it("carries the CSV's one price and duration on BOTH modes", async () => {
    const decision = await runImport({ offersInSalon: false, offersMobile: true })

    // Whichever mode the server derives is the one it stores a price for, and
    // it drops the other. Sending salon pricing alone would turn a correct
    // mobile derivation into a priceless mobile offering.
    expect(decision.salonPrice).toBe(140)
    expect(decision.mobilePrice).toBe(140)
    expect(decision.salonDurationMinutes).toBe(90)
    expect(decision.mobileDurationMinutes).toBe(90)
  })

  it('omits the modes even when the preview does not send the new fields', async () => {
    const decision = await runImport(null)

    // A server predating `defaultOfferingModes` derives them at commit anyway —
    // there is no version of this wizard that should state a mode it never asked
    // the pro about.
    expect('offersInSalon' in decision).toBe(false)
    expect('offersMobile' in decision).toBe(false)
  })
})

describe('MigrateServicesClient mode display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows a mobile-only pro's rows as Mobile, not Salon", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(previewBody({ offersInSalon: false, offersMobile: true })),
    )

    render(<MigrateServicesClient copy={COPY} />)
    const input = document.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input')
    fireEvent.change(input, {
      target: { files: [new File([''], 'menu.csv', { type: 'text/csv' })] },
    })

    // ServiceMapRow's pills. They read straight off the row's offering flags, so
    // the hardcoded pair made every pro's menu claim Salon on screen too.
    await waitFor(() => expect(screen.getByText('Mobile')).toBeTruthy())
    expect(screen.queryByText('Salon')).toBeNull()
  })
})
