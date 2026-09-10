// Client-side photo preparation for size-capped upload endpoints. The iOS app
// has always downscaled captures before upload (ConsultFlowView.swift: longest
// edge 1568px, then a JPEG quality ladder under the 5 MB cap); the web wizard
// shipped without that step, so raw phone photos over the cap died at presign
// with no path forward. Runs in the browser only.

import { resolveCropRect, type CropRect } from '@/lib/media/cropRect'

export const UPLOAD_IMAGE_MAX_DIMENSION = 1568
const JPEG_QUALITY_LADDER = [0.9, 0.78, 0.65, 0.52] as const

export class ImagePreparationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImagePreparationError'
  }
}

async function decodeToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // EXIF-corrected upright, because a CropRect is defined on the upright
    // stored frame (lib/media/cropRect.ts:6). <img> below is upright already.
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Some browsers cannot hand certain formats to createImageBitmap but can
    // still decode them through an <img> element.
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      await image.decode()
      return image
    } catch {
      throw new ImagePreparationError(
        'That photo format is not supported here. Try a JPG or PNG.',
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/**
 * Decodes the photo, scales its longest edge down to
 * UPLOAD_IMAGE_MAX_DIMENSION, and re-encodes as JPEG, stepping down the
 * quality ladder until the result fits maxBytes. Always re-encodes — that also
 * normalizes formats the server rejects (e.g. HEIC) and drops metadata.
 *
 * `crop` is optional and normalized to the upright frame. Omitted = the
 * whole frame. Supplied-but-unresolvable FAILS
 * CLOSED: {@link resolveCropRect} is lenient (malformed → null → full frame),
 * which is right for a display hint and wrong here — the pixels outside a
 * client-confirmed crop are pixels nobody agreed to upload. Validation is not
 * re-implemented; only its null is re-read as an error at this one call site.
 */
export async function prepareImageForUpload(
  file: Blob,
  maxBytes: number,
  crop?: CropRect,
): Promise<Blob> {
  const cropRect = crop === undefined ? null : crop && resolveCropRect(crop.x, crop.y, crop.w, crop.h)
  if (crop !== undefined && !cropRect) {
    // Before decoding: nothing to release, and nothing can fall through to a
    // full-frame upload.
    throw new ImagePreparationError('That crop could not be applied. Try cropping again.')
  }

  const canvas = document.createElement('canvas')
  const source = await decodeToBitmap(file)
  try {
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height
    if (!width || !height) {
      throw new ImagePreparationError('That photo could not be read. Try another one.')
    }
    // Crop first, then scale, so the longest-edge cap applies to what is kept.
    // Clamped: resolveCropRect allows EPSILON slack past an edge, which must
    // never become an out-of-bounds source rect.
    const sx = cropRect ? Math.min(width - 1, Math.max(0, Math.round(cropRect.x * width))) : 0
    const sy = cropRect ? Math.min(height - 1, Math.max(0, Math.round(cropRect.y * height))) : 0
    const sw = cropRect
      ? Math.max(1, Math.min(width - sx, Math.round(cropRect.w * width)))
      : width
    const sh = cropRect
      ? Math.max(1, Math.min(height - sy, Math.round(cropRect.h * height)))
      : height
    const scale = Math.min(1, UPLOAD_IMAGE_MAX_DIMENSION / Math.max(sw, sh))
    canvas.width = Math.max(1, Math.round(sw * scale))
    canvas.height = Math.max(1, Math.round(sh * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      throw new ImagePreparationError('This browser cannot process photos.')
    }
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  } finally {
    // Every exit, including the throws above, which used to leak the bitmap.
    if ('close' in source) source.close()
  }

  for (const quality of JPEG_QUALITY_LADDER) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (blob && blob.size > 0 && blob.size <= maxBytes) return blob
  }
  throw new ImagePreparationError(
    'That photo is too large even after resizing. Try another one.',
  )
}
