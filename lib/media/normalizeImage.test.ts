import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  ImageUnreadableError,
  NORMALIZED_IMAGE_MAX_BYTES,
  NORMALIZED_IMAGE_MAX_DIMENSION,
  normalizeImageForVision,
} from './normalizeImage'

// The provider bounds this envelope has to stay inside, from
// platform.claude.com/docs/en/build-with-claude/vision (read 2026-09-06):
// 10 MB per image measured on the BASE64 string, and 8000×8000 px.
const PROVIDER_MAX_BASE64_BYTES = 10_000_000
const PROVIDER_MAX_DIMENSION = 8000

/** A photo-like image: flat colour compresses to nothing and hides size bugs. */
async function noisyJpeg(
  width: number,
  height: number,
  quality = 92,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3)
  let seed = 12345
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    raw[i] = seed % 256
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer()
}

/** What both clients hand the server today: 1568px, re-encoded, no metadata. */
async function clientPreparedJpeg(): Promise<Buffer> {
  return noisyJpeg(1568, 1176, 78)
}

describe('normalizeImageForVision', () => {
  describe('the envelope it guarantees', () => {
    it('brings a 12000px-wide image inside both bounds', async () => {
      const wide = await noisyJpeg(12_000, 400)
      const result = await normalizeImageForVision(wide, 'image/jpeg')

      expect(result.rewritten).toBe(true)
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
        NORMALIZED_IMAGE_MAX_DIMENSION,
      )
      expect(result.bytes.byteLength).toBeLessThanOrEqual(NORMALIZED_IMAGE_MAX_BYTES)
      // The aspect ratio survives — a stretched reference would read as a
      // different photograph to the model. Compared as a ratio-of-ratios
      // because at 30:1 a single pixel of integer rounding is 0.15 of the
      // absolute value and says nothing about stretching.
      const ratio = result.width / result.height / (12_000 / 400)
      expect(ratio).toBeGreaterThan(0.99)
      expect(ratio).toBeLessThan(1.01)
    })

    it('brings a 20 MB portrait inside both bounds', async () => {
      // ~24 MP at quality 100 — the shape of a modern phone original.
      const huge = await noisyJpeg(4284, 5712, 100)
      expect(huge.byteLength).toBeGreaterThan(20_000_000)

      const result = await normalizeImageForVision(huge, 'image/jpeg')
      expect(result.rewritten).toBe(true)
      expect(result.height).toBeLessThanOrEqual(NORMALIZED_IMAGE_MAX_DIMENSION)
      expect(result.height).toBeGreaterThan(result.width) // still a portrait
      expect(result.bytes.byteLength).toBeLessThanOrEqual(NORMALIZED_IMAGE_MAX_BYTES)
    })

    it('leaves conformance implying provider-safety, not merely likely', async () => {
      const result = await normalizeImageForVision(await noisyJpeg(6000, 4000))
      const base64Length = result.bytes.toString('base64').length

      expect(base64Length).toBeLessThan(PROVIDER_MAX_BASE64_BYTES)
      expect(Math.max(result.width, result.height)).toBeLessThan(
        PROVIDER_MAX_DIMENSION,
      )
    })

    it('keeps a 7-shot analysis request inside the 32 MB request ceiling', () => {
      // The hair pack is 7 shots and every one of them passes through here, so
      // the per-image ceiling is what makes the whole request provable.
      const worstCaseBase64 = 7 * NORMALIZED_IMAGE_MAX_BYTES * (4 / 3)
      expect(worstCaseBase64).toBeLessThan(32_000_000)
    })
  })

  describe('existing normal-size paths', () => {
    it('passes a client-prepared photo through byte-identical', async () => {
      const prepared = await clientPreparedJpeg()
      const result = await normalizeImageForVision(prepared, 'image/jpeg')

      expect(result.rewritten).toBe(false)
      expect(result.contentType).toBe('image/jpeg')
      // Not "equivalent" — the same buffer. A re-encode here would add a
      // second generation of JPEG loss to every ordinary upload.
      expect(result.bytes.equals(prepared)).toBe(true)
    })

    it('passes a conformant PNG through as a PNG', async () => {
      const png = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 10, g: 120, b: 200 },
        },
      })
        .png()
        .toBuffer()

      const result = await normalizeImageForVision(png, 'image/png')
      expect(result.rewritten).toBe(false)
      expect(result.contentType).toBe('image/png')
    })
  })

  describe('EXIF orientation', () => {
    it('rotates a sideways photo upright', async () => {
      // Orientation 6 means "rotate 90° CW to display": a stored 400×200 is
      // meant to be seen as 200×400.
      const sideways = await sharp({
        create: {
          width: 400,
          height: 200,
          channels: 3,
          background: { r: 30, g: 30, b: 30 },
        },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer()

      const result = await normalizeImageForVision(sideways, 'image/jpeg')

      // 🔴 The regression this guards is silent: without `.rotate()` the output
      // is 400×200 AND the orientation tag has been stripped, so nothing
      // downstream can tell the model it is looking at a rotated photograph.
      expect(result.rewritten).toBe(true)
      expect(result.width).toBe(200)
      expect(result.height).toBe(400)
      expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined()
    })

    it('treats a non-upright orientation as reason enough to rewrite', async () => {
      const small = await sharp({
        create: {
          width: 100,
          height: 50,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .withMetadata({ orientation: 8 })
        .jpeg()
        .toBuffer()

      // Inside every size bound, so only the orientation forces the rewrite.
      expect(small.byteLength).toBeLessThan(NORMALIZED_IMAGE_MAX_BYTES)
      const result = await normalizeImageForVision(small)
      expect(result.rewritten).toBe(true)
      expect(result.width).toBe(50)
      expect(result.height).toBe(100)
    })
  })

  describe('metadata', () => {
    it('strips EXIF but keeps the colour profile', async () => {
      const tagged = await sharp({
        create: {
          width: 2400,
          height: 1600,
          channels: 3,
          background: { r: 90, g: 40, b: 60 },
        },
      })
        .withExif({ IFD0: { Make: 'TestCam', Software: 'test' } })
        .withIccProfile('p3')
        .jpeg()
        .toBuffer()

      const result = await normalizeImageForVision(tagged, 'image/jpeg')
      const meta = await sharp(result.bytes).metadata()

      expect(result.rewritten).toBe(true)
      expect(meta.exif).toBeUndefined()
      // Kept on purpose. Dropping a P3 profile in a hair-COLOUR consult
      // reinterprets every pixel; measured at up to 117/255 per channel.
      expect(meta.icc).toBeDefined()
    })
  })

  describe('an image that genuinely cannot be read', () => {
    it('throws rather than returning something', async () => {
      await expect(
        normalizeImageForVision(Buffer.from('this is not an image')),
      ).rejects.toBeInstanceOf(ImageUnreadableError)
    })

    it('throws on a truncated file', async () => {
      const jpeg = await noisyJpeg(600, 400)
      const truncated = jpeg.subarray(0, Math.floor(jpeg.byteLength / 2))
      await expect(
        normalizeImageForVision(truncated, 'image/jpeg'),
      ).rejects.toBeInstanceOf(ImageUnreadableError)
    })

    it('throws on empty bytes', async () => {
      await expect(
        normalizeImageForVision(Buffer.alloc(0)),
      ).rejects.toBeInstanceOf(ImageUnreadableError)
    })
  })

  describe('Tori’s 2026-09-06 case', () => {
    it('normalizes the shape of Look cmthrcxjv0005jg04dz1wn8rd', async () => {
      // The published original that failed on production: 5712×4284, and
      // 5,032,646 bytes — 32,646 over the 5,000,000-byte ceiling that refused
      // it. Reproduced by shape here; the real bytes run in the live contract
      // test (tests/live/consult-image-normalization.live.test.ts).
      const look = await noisyJpeg(5712, 4284, 100)
      expect(look.byteLength).toBeGreaterThan(5_000_000)

      const result = await normalizeImageForVision(look, 'image/jpeg')
      expect(result.rewritten).toBe(true)
      expect(result.bytes.byteLength).toBeLessThan(5_000_000)
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
        NORMALIZED_IMAGE_MAX_DIMENSION,
      )
    })
  })
})
