// lib/media/evidenceBundleData.ts
//
// Gathers everything needed to render a booking's evidence bundle: the
// booking/client/service summary, each MediaAsset's bytes (downloaded fresh
// from storage, same as the hash step), and its MediaCaptureAttestation row
// when one exists. Pure data-gathering — lib/media/evidenceBundlePdf.ts does
// the rendering, mirroring lib/finance/financeExportData.ts +
// proFinanceScheduleCPdf.ts's gather/render split.
//
// A MediaAsset with no attestation is NOT an error here — it's every asset
// captured before this feature shipped (there is no backfill), and the PDF
// says so explicitly rather than silently omitting the photo.

import 'server-only'

import type { MediaPhase, MediaType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/time'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'

export type EvidenceBundleAttestation = {
  sha256Server: string
  sha256Client: string | null
  hashMismatch: boolean
  capturedAtClaimed: Date | null
  receivedAt: Date
}

export type EvidenceBundleAsset = {
  mediaAssetId: string
  phase: MediaPhase
  mediaType: MediaType
  caption: string | null
  createdAt: Date
  storageBucket: string
  storagePath: string
  /** Freshly downloaded bytes for embedding, or null if the download failed. */
  bytes: Uint8Array | null
  downloadError: string | null
  /** Null when this asset was captured before attestation existed — no backfill. */
  attestation: EvidenceBundleAttestation | null
}

export type EvidenceBundleData = {
  bookingId: string
  professionalId: string
  clientName: string
  serviceName: string
  scheduledFor: Date
  timeZone: string
  bookingStatus: string
  assets: EvidenceBundleAsset[]
}

export type GatherEvidenceBundleOutcome =
  | { ok: true; data: EvidenceBundleData }
  | { ok: false; status: number; error: string }

export async function gatherEvidenceBundleData(input: {
  bookingId: string
  professionalId: string
}): Promise<GatherEvidenceBundleOutcome> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      scheduledFor: true,
      locationTimeZone: true,
      client: { select: { firstName: true, lastName: true, email: true } },
      service: { select: { name: true } },
    },
  })

  // Uniform 404 on a foreign booking — same no-existence-leak contract as
  // listProBookingMedia (lib/proBookingMedia.ts).
  if (!booking || booking.professionalId !== input.professionalId) {
    return { ok: false, status: 404, error: 'Booking not found.' }
  }

  const mediaRows = await prisma.mediaAsset.findMany({
    where: { bookingId: input.bookingId },
    select: {
      id: true,
      phase: true,
      mediaType: true,
      caption: true,
      createdAt: true,
      storageBucket: true,
      storagePath: true,
      captureAttestation: {
        select: {
          sha256Server: true,
          sha256Client: true,
          hashMismatch: true,
          capturedAtClaimed: true,
          receivedAt: true,
        },
      },
    },
    orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
  })

  if (mediaRows.length === 0) {
    return { ok: false, status: 404, error: 'This booking has no session photos.' }
  }

  const assets = await Promise.all(
    mediaRows.map(async (row): Promise<EvidenceBundleAsset> => {
      let bytes: Uint8Array | null = null
      let downloadError: string | null = null

      try {
        const { data, error } = await getSupabaseAdmin()
          .storage.from(row.storageBucket)
          .download(row.storagePath, {}, { cache: 'no-store' })

        if (error || !data) {
          downloadError = 'Could not retrieve the stored file for this bundle.'
        } else {
          bytes = new Uint8Array(await data.arrayBuffer())
        }
      } catch {
        downloadError = 'Could not retrieve the stored file for this bundle.'
      }

      return {
        mediaAssetId: row.id,
        phase: row.phase,
        mediaType: row.mediaType,
        caption: row.caption,
        createdAt: row.createdAt,
        storageBucket: row.storageBucket,
        storagePath: row.storagePath,
        bytes,
        downloadError,
        attestation: row.captureAttestation,
      }
    }),
  )

  const clientName = formatClientName(booking.client)

  return {
    ok: true,
    data: {
      bookingId: booking.id,
      professionalId: booking.professionalId,
      clientName,
      serviceName: booking.service.name,
      scheduledFor: booking.scheduledFor,
      timeZone: sanitizeTimeZone(booking.locationTimeZone, DEFAULT_TIME_ZONE),
      bookingStatus: booking.status,
      assets,
    },
  }
}
