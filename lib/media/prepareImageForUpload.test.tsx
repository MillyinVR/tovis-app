import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ImagePreparationError,
  prepareImageForUpload,
  UPLOAD_IMAGE_MAX_DIMENSION,
} from '@/lib/media/prepareImageForUpload'

const MAX_BYTES = 5 * 1024 * 1024

function stubBitmap(width = 4000, height = 3000) {
  const bitmap = { width, height, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  return bitmap
}

function stubCanvas(byteSize = 1024) {
  const canvas = document.createElement('canvas')
  const context = { drawImage: vi.fn() }
  Object.defineProperty(canvas, 'getContext', { configurable: true, value: vi.fn(() => context) })
  const toBlob = vi
    .spyOn(canvas, 'toBlob')
    .mockImplementation((cb, type) => cb(new Blob([new Uint8Array(byteSize)], { type })))
  vi.spyOn(document, 'createElement').mockReturnValue(canvas)
  return { canvas, context, toBlob }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('prepareImageForUpload', () => {
  it('without a crop, draws the whole frame scaled to the longest edge', async () => {
    const bitmap = stubBitmap()
    const { canvas, context, toBlob } = stubCanvas()

    const out = await prepareImageForUpload(new Blob(['raw']), MAX_BYTES)

    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 4000, 3000, 0, 0, 1568, 1176)
    expect([canvas.width, canvas.height]).toEqual([UPLOAD_IMAGE_MAX_DIMENSION, 1176])
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9)
    expect(out.type).toBe('image/jpeg')
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('crops the requested source pixels and scales the CROP, not the frame', async () => {
    const bitmap = stubBitmap()
    const { canvas, context } = stubCanvas()

    await prepareImageForUpload(new Blob(['raw']), MAX_BYTES, { x: 0.25, y: 0.1, w: 0.5, h: 0.4 })

    // 4000x3000 → source rect 1000,300 2000x1200; 1568/2000 = 0.784.
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 1000, 300, 2000, 1200, 0, 0, 1568, 941)
    expect([canvas.width, canvas.height]).toEqual([1568, 941])
  })

  it('never upscales a crop already under the cap', async () => {
    stubBitmap(1000, 800)
    const { canvas } = stubCanvas()

    await prepareImageForUpload(new Blob(['raw']), MAX_BYTES, { x: 0, y: 0, w: 0.5, h: 0.5 })

    expect([canvas.width, canvas.height]).toEqual([500, 400])
  })

  it.each([
    ['out of bounds', { x: 0.6, y: 0, w: 0.5, h: 1 }],
    ['negative origin', { x: -0.2, y: 0, w: 0.5, h: 0.5 }],
    ['zero extent', { x: 0.1, y: 0.1, w: 0, h: 0.5 }],
    ['non-finite', { x: Number.NaN, y: 0, w: 0.5, h: 0.5 }],
  ])('fails closed on a %s crop instead of uploading the full frame', async (_label, crop) => {
    stubBitmap()
    const { context, toBlob } = stubCanvas()

    await expect(prepareImageForUpload(new Blob(['raw']), MAX_BYTES, crop)).rejects.toBeInstanceOf(
      ImagePreparationError,
    )
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(toBlob).not.toHaveBeenCalled()
  })

  it('releases the bitmap when the canvas context is unavailable', async () => {
    const bitmap = stubBitmap()
    const { canvas } = stubCanvas()
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)

    await expect(prepareImageForUpload(new Blob(['raw']), MAX_BYTES)).rejects.toBeInstanceOf(
      ImagePreparationError,
    )
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('walks the quality ladder and rejects when nothing fits maxBytes', async () => {
    stubBitmap()
    const { toBlob } = stubCanvas(4096)

    await expect(
      prepareImageForUpload(new Blob(['raw']), 1024, { x: 0, y: 0, w: 1, h: 1 }),
    ).rejects.toBeInstanceOf(ImagePreparationError)
    expect(toBlob).toHaveBeenCalledTimes(4)
  })
})

