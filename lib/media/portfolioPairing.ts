import 'server-only'

import { MediaPhase, MediaType } from '@prisma/client'

import { loadPrimaryBeforeAssetId } from '@/lib/media/bookingBeforeAfter'
import { prisma } from '@/lib/prisma'

/**
 * Shared before/after pairing resolution for the portfolio-feature paths.
 *
 * The pairing lives on the displayed "after" asset (`MediaAsset.beforeAssetId`)
 * and drives the comparison slider. Both feature endpoints — the portfolio
 * POST/DELETE toggle and the media PATCH edit — resolve it through here so the
 * behaviour (validation + default-on auto-pair) never drifts.
 */

/** How the request expressed the pairing: omitted, an explicit id, or cleared. */
export type PairField = { present: boolean; value: string | null }

/**
 * Read an optional `beforeAssetId` from a request body, distinguishing three
 * cases: omitted (auto-pair from the booking, the default-on behaviour), an
 * explicit id (pair with that specific before), or explicit null / non-string
 * (unpair). Callers that just toggle the feature flag send no field → auto-pair.
 */
export function parseBeforeAssetField(body: unknown): PairField {
  if (!body || typeof body !== 'object' || !('beforeAssetId' in body)) {
    return { present: false, value: null }
  }
  const raw = (body as Record<string, unknown>).beforeAssetId
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return { present: true, value: trimmed.length > 0 ? trimmed : null }
  }
  return { present: true, value: null }
}

/**
 * Validate an explicitly-chosen "before": it must be another photo owned by the
 * same pro (never a video, never the after itself). Keeps a pro from pairing
 * across tenants or with a foreign asset id.
 */
export async function validateExplicitBefore(
  beforeAssetId: string,
  professionalId: string,
  afterAssetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (beforeAssetId === afterAssetId) {
    return { ok: false, error: 'A photo can’t be paired with itself.' }
  }
  const before = await prisma.mediaAsset.findUnique({
    where: { id: beforeAssetId },
    select: { id: true, professionalId: true, mediaType: true },
  })
  if (!before || before.professionalId !== professionalId) {
    return { ok: false, error: 'Before photo not found.' }
  }
  if (before.mediaType !== MediaType.IMAGE) {
    return { ok: false, error: 'A before/after pair must both be photos.' }
  }
  return { ok: true }
}

/**
 * Default-on pairing: when a pro features an "after" that came from a booking,
 * pair it with that booking's primary before. Skips videos and BEFORE-phase
 * photos (a before isn't an "after"), and assets with no booking.
 */
export async function resolveAutoPairedBefore(
  media: { mediaType: MediaType; phase: MediaPhase; bookingId: string | null },
  afterAssetId: string,
): Promise<string | null> {
  if (media.mediaType !== MediaType.IMAGE) return null
  if (media.phase === MediaPhase.BEFORE) return null
  if (!media.bookingId) return null
  return loadPrimaryBeforeAssetId(media.bookingId, afterAssetId)
}

/**
 * Resolve the `beforeAssetId` to write when featuring an "after": an explicit
 * body value wins (validated), an explicit null unpairs, and an omitted field
 * auto-pairs from the booking. Shared by the POST feature toggle (always
 * resolves) — PATCH decides separately whether to call this at all.
 */
export async function resolveFeaturePairing(args: {
  afterAssetId: string
  professionalId: string
  media: { mediaType: MediaType; phase: MediaPhase; bookingId: string | null }
  pairField: PairField
}): Promise<
  { ok: true; beforeAssetId: string | null } | { ok: false; error: string }
> {
  const { afterAssetId, professionalId, media, pairField } = args

  if (pairField.present) {
    if (pairField.value === null) return { ok: true, beforeAssetId: null }
    const check = await validateExplicitBefore(
      pairField.value,
      professionalId,
      afterAssetId,
    )
    if (!check.ok) return { ok: false, error: check.error }
    return { ok: true, beforeAssetId: pairField.value }
  }

  return {
    ok: true,
    beforeAssetId: await resolveAutoPairedBefore(media, afterAssetId),
  }
}
