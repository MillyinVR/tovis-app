// lib/media/attestCapture.ts
//
// Writes the one-time, append-only MediaCaptureAttestation row for a freshly
// created MediaAsset. There is no update path for this table anywhere in the
// app (by design — see the model doc comment in prisma/schema.prisma) and no
// delete route either; the only delete path is the account-deletion boundary
// (lib/privacy/deleteRules.ts), which is why mediaAssetId cascades instead of
// being hand-cleared there.
//
// This is a single choke point so every MediaAsset-creating surface that
// wants attestation calls the same hash-then-write logic — see
// lib/media/hashStorageObject.ts for why the hash has to be a download, not a
// trust of what the client sent.

import 'server-only'

import { prisma } from '@/lib/prisma'
import { UPLOAD_MAX_BYTES } from '@/lib/media/uploadLimits'
import { hashStorageObjectBytes } from '@/lib/media/hashStorageObject'

export type AttestMediaCaptureInput = {
  mediaAssetId: string
  bookingId: string | null
  professionalId: string
  storageBucket: string
  storagePath: string
  // Device-claimed capture time — never verified. Null when the caller didn't
  // send one (every upload today, until the iOS capture path ships it).
  capturedAtClaimed: Date | null
  // Device-claimed checksum — never trusted alone. Null when the caller
  // didn't send one.
  clientChecksumSha256: string | null
  now: Date
}

export type MediaCaptureAttestationResult = {
  sha256Server: string
  hashMismatch: boolean
}

/**
 * Downloads the uploaded bytes, hashes them server-side, and writes the
 * attestation row. sha256Server is the only hash this app trusts. When the
 * caller sent a checksum, it's stored alongside for comparison and
 * `hashMismatch` is set when it doesn't match — evidence the CLAIM was wrong,
 * not proof of what happened to the bytes in transit.
 *
 * Throws (MediaHashError from the download, or a Prisma error from the write)
 * on any failure — callers that don't want a hashing hiccup to fail the whole
 * upload should catch around this call, not treat it as never-throws.
 */
export async function attestMediaCapture(
  input: AttestMediaCaptureInput,
): Promise<MediaCaptureAttestationResult> {
  const { sha256 } = await hashStorageObjectBytes({
    bucket: input.storageBucket,
    path: input.storagePath,
    maxBytes: UPLOAD_MAX_BYTES,
  })

  const hashMismatch =
    input.clientChecksumSha256 != null && input.clientChecksumSha256 !== sha256

  await prisma.mediaCaptureAttestation.create({
    data: {
      mediaAssetId: input.mediaAssetId,
      bookingId: input.bookingId,
      professionalId: input.professionalId,
      sha256Server: sha256,
      sha256Client: input.clientChecksumSha256,
      hashMismatch,
      capturedAtClaimed: input.capturedAtClaimed,
      receivedAt: input.now,
    },
  })

  return { sha256Server: sha256, hashMismatch }
}
