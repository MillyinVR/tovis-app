import 'server-only'

import sharp from 'sharp'
import type { Metadata, OutputInfo } from 'sharp'

// lib/media/normalizeImage.ts
//
// P2e — the one server-side place an image is made safe to hand to a vision
// model.
//
// Why it exists: on 2026-09-06 a production consult analysis failed three
// times per run, twice over, because the Look the client picked as her
// reference is a 5,032,646-byte 5712×4284 JPEG — 32,646 bytes over the
// consult's own 5,000,000-byte ceiling. The refusal happened at READ, several
// stages after the reference had been accepted, and the client was shown a
// generic "we couldn't finish your plan" with a Try again that re-ran the same
// guaranteed-to-fail work.
//
// The fix is not a bigger ceiling. It is that every image handed to a model is
// first brought inside a known envelope, at the one choke point each source
// passes through.
//
// ── The envelope, and where each bound comes from ──────────────────────────
//
// Long edge ≤ 1568 px. Both clients already target exactly this
//   (lib/media/prepareImageForUpload.ts, ios ConsultPhotoPreparation.jpeg), so
//   a photo either client prepared is already conformant and is passed through
//   BYTE-IDENTICAL. That is deliberate: re-encoding a conformant image would
//   add a second JPEG generation to every normal upload for no gain.
//
// ≤ 2,000,000 bytes. The tightest bound downstream is the consult's own
//   CONSULT_CAPTURE_MAX_BYTES (5,000,000), so this is a 60% margin under it.
//   It is also what makes the multi-image analysis request provably safe: the
//   hair pack is 7 shots, and 7 × 2 MB = 14 MB raw ≈ 18.7 MB base64, inside
//   the Claude API's 32 MB request ceiling. A ladder that could emit 3.5 MB
//   per image would not clear that arithmetic.
//
// Both bounds sit far inside the provider's own limits (10 MB base64 per
// image, 8000×8000 px), so conformance here implies provider-safety and the
// two never have to be reasoned about separately.
//
// ── What is stripped, and what is deliberately NOT ─────────────────────────
//
// EXIF, IPTC and XMP are dropped: they carry GPS, device identity and capture
// timestamps that have no business reaching a provider.
//
// The ICC colour profile is KEPT. This is a hair-colour product; the profile
// is how a Display P3 phone photo's pixels are meant to be read, and dropping
// it silently reinterprets every colour in the frame. Verified with sharp
// 0.35.4: dropping a P3 profile moves channel values by up to 117/255. It is
// also not personal data. So it stays.
//
// ── EXIF rotation is mandatory, and its failure is silent ──────────────────
//
// 🔴 `.rotate()` with no argument is what applies the EXIF orientation tag.
// Verified: a 400×200 JPEG tagged orientation 6 comes back 200×400 with
// `.rotate()`, and 400×200 WITHOUT it — and in the second case sharp has
// already dropped the orientation tag, so the sideways result carries nothing
// that says it is sideways. Every downstream reader, model included, then sees
// a rotated photograph and never knows. Do not remove the `.rotate()`.

export const NORMALIZED_IMAGE_MAX_DIMENSION = 1568

/** See the envelope note above — this is what makes a 7-shot request safe. */
export const NORMALIZED_IMAGE_MAX_BYTES = 2_000_000

/**
 * Matches the ladders both clients already walk, so a re-encode here lands in
 * the same place a client-prepared photo would have.
 */
const JPEG_QUALITY_LADDER = [90, 78, 65, 52] as const

export const NORMALIZED_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type NormalizedImageMediaType = (typeof NORMALIZED_IMAGE_MEDIA_TYPES)[number]

/**
 * The image could not be decoded at all, or could not be brought inside the
 * envelope. Callers turn this into a visible "we couldn't read this one, try
 * another" with a retry — never into a silent skip (Part 0 rule 4).
 */
export class ImageUnreadableError extends Error {
  constructor(
    readonly reason: 'undecodable' | 'incompressible',
    message: string,
  ) {
    super(message)
    this.name = 'ImageUnreadableError'
  }
}

export type NormalizedImage = {
  bytes: Buffer
  contentType: NormalizedImageMediaType
  width: number
  height: number
  /**
   * False when the input was already conformant and is being returned
   * unchanged. Ingest call sites use this to skip a pointless rewrite; tests
   * use it to prove normal-size paths are untouched.
   */
  rewritten: boolean
}

function isMediaType(value: unknown): value is NormalizedImageMediaType {
  return NORMALIZED_IMAGE_MEDIA_TYPES.some((candidate) => candidate === value)
}

type Probe = {
  width: number
  height: number
  format: NormalizedImageMediaType | null
  orientation: number | null
  hasPrivateMetadata: boolean
}

async function probe(bytes: Buffer): Promise<Probe> {
  let metadata: Metadata
  try {
    const image = sharp(bytes, { failOn: 'error' })
    metadata = await image.metadata()
    // 🔴 `metadata()` alone is NOT proof the image decodes. It reads the
    // header, so a JPEG truncated in half — an interrupted upload, the normal
    // way this happens — reports its full 600×400 and looks perfectly
    // conformant. Without this line such a file took the pass-through branch
    // and went to the model undecoded, which is precisely the silent forward
    // this module exists to prevent. `stats()` forces a full decode and throws
    // on "premature end of JPEG"; measured at 15ms for a 1568px image, which
    // is what a guarantee costs.
    await image.stats()
  } catch {
    throw new ImageUnreadableError('undecodable', 'The image could not be read.')
  }
  const { width, height } = metadata
  if (!width || !height) {
    throw new ImageUnreadableError('undecodable', 'The image has no dimensions.')
  }
  const format =
    metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : null
  return {
    width,
    height,
    format,
    orientation: metadata.orientation ?? null,
    // `exif` also covers the orientation tag; iptc/xmp are separate buffers.
    hasPrivateMetadata: Boolean(metadata.exif ?? metadata.iptc ?? metadata.xmp),
  }
}

/**
 * Already inside the envelope, upright, and carrying nothing personal — so
 * there is nothing for a re-encode to improve and one generation of JPEG loss
 * for it to cost.
 */
function isConformant(
  bytes: Buffer,
  found: Probe,
): found is Probe & { format: NormalizedImageMediaType } {
  return (
    found.format !== null &&
    bytes.byteLength <= NORMALIZED_IMAGE_MAX_BYTES &&
    Math.max(found.width, found.height) <= NORMALIZED_IMAGE_MAX_DIMENSION &&
    (found.orientation === null || found.orientation === 1) &&
    !found.hasPrivateMetadata
  )
}

/**
 * Bring an image inside the envelope: upright from EXIF, long edge and byte
 * count bounded, personal metadata gone, colour profile intact.
 *
 * Returns the input untouched when it already conforms. Throws
 * ImageUnreadableError — never a partial or a fallback — when it cannot.
 */
export async function normalizeImageForVision(
  input: Uint8Array,
  declaredContentType?: string | null,
): Promise<NormalizedImage> {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (bytes.byteLength < 1) {
    throw new ImageUnreadableError('undecodable', 'The image is empty.')
  }
  const found = await probe(bytes)

  if (
    isConformant(bytes, found) &&
    // A declared type that disagrees with the decoded one is a rewrite, not a
    // pass-through: downstream stores the declared type beside the bytes.
    (!declaredContentType ||
      !isMediaType(declaredContentType) ||
      declaredContentType === found.format)
  ) {
    return {
      bytes,
      contentType: found.format,
      width: found.width,
      height: found.height,
      rewritten: false,
    }
  }

  // 🔴 `.rotate()` FIRST and with no argument — see the header note. Placing a
  // resize before it would size the wrong axes.
  const pipeline = sharp(bytes, { failOn: 'error' })
    .rotate()
    .resize({
      width: NORMALIZED_IMAGE_MAX_DIMENSION,
      height: NORMALIZED_IMAGE_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // A transparent PNG has no alpha once it is a JPEG; say what it lands on
    // rather than letting the encoder choose black.
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .keepIccProfile()

  for (const quality of JPEG_QUALITY_LADDER) {
    let encoded: { data: Buffer; info: OutputInfo }
    try {
      encoded = await pipeline
        .clone()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
    } catch {
      throw new ImageUnreadableError(
        'undecodable',
        'The image could not be re-encoded.',
      )
    }
    if (encoded.data.byteLength <= NORMALIZED_IMAGE_MAX_BYTES) {
      // The envelope is asserted on the OUTPUT, not assumed from the settings.
      if (
        encoded.info.width > NORMALIZED_IMAGE_MAX_DIMENSION ||
        encoded.info.height > NORMALIZED_IMAGE_MAX_DIMENSION
      ) {
        throw new ImageUnreadableError(
          'incompressible',
          'The image could not be resized.',
        )
      }
      return {
        bytes: encoded.data,
        contentType: 'image/jpeg',
        width: encoded.info.width,
        height: encoded.info.height,
        rewritten: true,
      }
    }
  }

  throw new ImageUnreadableError(
    'incompressible',
    'The image is too large even after resizing.',
  )
}
