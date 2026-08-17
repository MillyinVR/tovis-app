// lib/media/evidenceBundlePdf.test.ts
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { MediaPhase, MediaType } from '@prisma/client'

import { buildEvidenceBundlePdf } from './evidenceBundlePdf'
import type { EvidenceBundleAsset, EvidenceBundleData } from './evidenceBundleData'

// A real, minimal 1x1 transparent PNG — a well-known test fixture. Must be a
// genuine valid PNG (not just the magic bytes): pdf-lib's embedPng fully
// parses it.
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function validPngBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(VALID_PNG_BASE64, 'base64'))
}

const ATTESTATION = {
  sha256Server: 'a'.repeat(64),
  sha256Client: null,
  hashMismatch: false,
  capturedAtClaimed: null,
  receivedAt: new Date('2026-08-10T18:05:00.000Z'),
}

function makeAsset(overrides?: Partial<EvidenceBundleAsset>): EvidenceBundleAsset {
  return {
    mediaAssetId: 'media_1',
    phase: MediaPhase.BEFORE,
    mediaType: MediaType.IMAGE,
    caption: null,
    createdAt: new Date('2026-08-10T18:04:00.000Z'),
    storageBucket: 'media-private',
    storagePath: 'bookings/booking_1/before/main.jpg',
    bytes: validPngBytes(),
    downloadError: null,
    attestation: ATTESTATION,
    ...overrides,
  }
}

function makeData(assets: EvidenceBundleAsset[]): EvidenceBundleData {
  return {
    bookingId: 'booking_1',
    professionalId: 'pro_1',
    clientName: 'Ada Lovelace',
    serviceName: 'Balayage',
    scheduledFor: new Date('2026-08-10T18:00:00.000Z'),
    timeZone: 'America/Los_Angeles',
    bookingStatus: 'COMPLETED',
    assets,
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

describe('buildEvidenceBundlePdf', () => {
  it('produces a loadable PDF with a filename keyed on the booking', async () => {
    const result = await buildEvidenceBundlePdf(makeData([makeAsset()]), 'Tovis')
    expect(result.filename).toBe('evidence-bundle-booking_1.pdf')
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined()
  })

  it('emits cover page + original + stamped copy for an embeddable image', async () => {
    const result = await buildEvidenceBundlePdf(makeData([makeAsset()]), 'Tovis')
    expect(await pageCount(result.bytes)).toBe(3)
  })

  it('emits only cover + one no-preview page for unembeddable bytes', async () => {
    const asset = makeAsset({ bytes: new Uint8Array([1, 2, 3, 4]) })
    const result = await buildEvidenceBundlePdf(makeData([asset]), 'Tovis')
    expect(await pageCount(result.bytes)).toBe(2)
  })

  it('never attempts to embed a video as an image, even with image-shaped bytes', async () => {
    const asset = makeAsset({ mediaType: MediaType.VIDEO })
    const result = await buildEvidenceBundlePdf(makeData([asset]), 'Tovis')
    expect(await pageCount(result.bytes)).toBe(2)
  })

  it('handles a failed download (null bytes) with a single no-preview page', async () => {
    const asset = makeAsset({ bytes: null, downloadError: 'Could not retrieve the stored file.' })
    const result = await buildEvidenceBundlePdf(makeData([asset]), 'Tovis')
    expect(await pageCount(result.bytes)).toBe(2)
  })

  it('handles an asset with no attestation on file without throwing', async () => {
    const asset = makeAsset({ attestation: null })
    const result = await buildEvidenceBundlePdf(makeData([asset]), 'Tovis')
    expect(await pageCount(result.bytes)).toBe(3)
  })

  it('handles a mismatched client checksum without throwing', async () => {
    const asset = makeAsset({
      attestation: { ...ATTESTATION, sha256Client: 'b'.repeat(64), hashMismatch: true },
    })
    const result = await buildEvidenceBundlePdf(makeData([asset]), 'Tovis')
    expect(await pageCount(result.bytes)).toBe(3)
  })

  it('sums pages correctly across a mix of embeddable and non-embeddable assets', async () => {
    const assets = [
      makeAsset({ mediaAssetId: 'a', phase: MediaPhase.BEFORE }),
      makeAsset({ mediaAssetId: 'b', phase: MediaPhase.AFTER, bytes: new Uint8Array([9, 9]) }),
      makeAsset({ mediaAssetId: 'c', phase: MediaPhase.OTHER, mediaType: MediaType.VIDEO }),
    ]
    const result = await buildEvidenceBundlePdf(makeData(assets), 'Tovis')
    // cover(1) + [orig+stamped](2) + [orig only](1) + [orig only](1)
    expect(await pageCount(result.bytes)).toBe(1 + 2 + 1 + 1)
  })
})
