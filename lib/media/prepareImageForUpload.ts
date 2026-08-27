// Client-side photo preparation for size-capped upload endpoints. The iOS app
// has always downscaled captures before upload (ConsultFlowView.swift: longest
// edge 1568px, then a JPEG quality ladder under the 5 MB cap); the web wizard
// shipped without that step, so raw phone photos over the cap died at presign
// with no path forward. Runs in the browser only.

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
    return await createImageBitmap(file)
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
 */
export async function prepareImageForUpload(
  file: Blob,
  maxBytes: number,
): Promise<Blob> {
  const source = await decodeToBitmap(file)
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height
  if (!width || !height) {
    throw new ImagePreparationError('That photo could not be read. Try another one.')
  }
  const scale = Math.min(1, UPLOAD_IMAGE_MAX_DIMENSION / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new ImagePreparationError('This browser cannot process photos.')
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  if ('close' in source) source.close()

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
