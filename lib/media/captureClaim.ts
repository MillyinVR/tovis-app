// lib/media/captureClaim.ts
//
// Parses the two capture-attestation fields a client MAY send alongside a
// media upload: the sha256 it computed at capture time, and the device clock's
// capture timestamp. Both are CLAIMS, not proof — see MediaCaptureAttestation
// in prisma/schema.prisma for what each one does and doesn't establish.
//
// Lenient by design, matching this route's existing focalX/focalY handling
// (lib/media/focalPoint.ts): a missing or malformed claim degrades to null and
// never turns into a 400. The upload is the pro's proof-of-service photo; a
// client that can't/didn't send attestation metadata should still be able to
// save it. lib/consult/captureContract.ts's validChecksum() enforces the same
// sha256 shape but THROWS on a bad value — that's the right contract for its
// idempotency-keyed consult-capture writes, wrong for this lenient surface, so
// it's not reused here rather than threading a throw/degrade mode through it.

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** Lenient — an absent or malformed checksum degrades to null, never a 400. */
export function parseSha256Hex(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()

  return SHA256_HEX_PATTERN.test(normalized) ? normalized : null
}

/**
 * Lenient — an absent or unparsable capturedAt degrades to null, never a 400.
 * Deliberately NOT bounds-checked against server time: a wrong device clock,
 * or an offline capture uploaded hours later, is itself part of what this
 * field honestly records rather than something to reject.
 */
export function parseCapturedAtClaimed(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}
