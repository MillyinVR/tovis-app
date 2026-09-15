import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { MediaType } from '@prisma/client'
const mocks = vi.hoisted(() => ({ signedUrl: vi.fn(), bucket: vi.fn(), fetch: vi.fn(), video: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({ storage: { from: mocks.bucket } }) }))
vi.mock('./videoFrames', () => ({ extractLookVideoFrames: mocks.video }))
import { loadLookAnalysisFrames } from './images'
import { asset } from './testFixtures'

const photo = { ...asset, mediaType: MediaType.IMAGE, storagePath: 'pro-1/photo.png' }
async function twoColorImage(orientation?: number) {
  // Left half red, right half blue. Whole-color assertions below detect any leaked half.
  const raw = Buffer.alloc(80 * 40 * 3)
  for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) raw[(y * 80 + x) * 3 + (x < 40 ? 0 : 2)] = 255
  const image = sharp(raw, { raw: { width: 80, height: 40, channels: 3 } })
  return orientation ? image.withMetadata({ orientation }).png().toBuffer() : image.png().toBuffer()
}
function mediaResponse(bytes: Uint8Array, cancel = vi.fn()) {
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) { if (sent) controller.close(); else { sent = true; controller.enqueue(bytes) } }, cancel,
  }))
}
async function expectOnlyRed(base64: string, width: number, height: number) {
  const output = Buffer.from(base64, 'base64')
  const metadata = await sharp(output).metadata()
  expect(metadata).toMatchObject({ format: 'jpeg', width, height })
  expect(metadata.orientation).toBeUndefined()
  const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += info.channels) {
    expect(data[i]).toBeGreaterThan(230)
    expect(data[i + 1]).toBeLessThan(20)
    expect(data[i + 2]).toBeLessThan(20)
  }
}
beforeEach(() => {
  mocks.bucket.mockReturnValue({ createSignedUrl: mocks.signedUrl })
  mocks.signedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example.test/signed-photo' }, error: null })
  vi.stubGlobal('fetch', mocks.fetch)
})

describe('normalized published crop', () => {
  it('retains only approved pixels in the actual encoded JPEG', async () => {
    mocks.fetch.mockResolvedValue(mediaResponse(await twoColorImage()))
    const result = await loadLookAnalysisFrames({ ...photo, cropX: 0, cropY: 0, cropW: 0.5, cropH: 1 })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ atSeconds: 0, mediaType: 'image/jpeg' })
    if (!result[0]) throw new Error('Expected one normalized frame')
    await expectOnlyRed(result[0].base64, 40, 40)
    expect(mocks.video).not.toHaveBeenCalled()
  })
  it('applies crop coordinates after EXIF rotation and strips the orientation tag', async () => {
    mocks.fetch.mockResolvedValue(mediaResponse(await twoColorImage(6)))
    // EXIF6 rotates clockwise: the former left/red half is now the upper half.
    const result = await loadLookAnalysisFrames({ ...photo, cropX: 0, cropY: 0, cropW: 1, cropH: 0.5 })
    if (!result[0]) throw new Error('Expected one normalized frame')
    await expectOnlyRed(result[0].base64, 40, 40)
  })
  it.each([
    { cropX: 0.1, cropY: null, cropW: null, cropH: null },
    { cropX: 0, cropY: 0, cropW: 0, cropH: 1 },
  ])('rejects partial or invalid crop instead of exposing the whole image', async crop => {
    mocks.fetch.mockResolvedValue(mediaResponse(await twoColorImage()))
    await expect(loadLookAnalysisFrames({ ...photo, ...crop })).rejects.toThrow('Invalid published crop')
  })
})

describe('storage and streaming boundaries', () => {
  it('uses server storage pointers and rejects redirects', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed: redirect'))
    await expect(loadLookAnalysisFrames(photo)).rejects.toThrow('redirect')
    expect(mocks.bucket).toHaveBeenCalledWith(photo.storageBucket)
    expect(mocks.signedUrl).toHaveBeenCalledWith(photo.storagePath, 60)
    expect(mocks.fetch).toHaveBeenCalledWith('https://storage.example.test/signed-photo', { redirect: 'error', signal: expect.any(AbortSignal) })
  })
  it('stops reading and cancels the stream at the photo byte limit', async () => {
    const cancel = vi.fn()
    // Keep the stream open so cancellation after the oversized chunk is observable.
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1)) }, cancel }))
    mocks.fetch.mockResolvedValue(response)
    await expect(loadLookAnalysisFrames(photo)).rejects.toThrow('Media exceeds analysis limit')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(mocks.video).not.toHaveBeenCalled()
  })
  it('does not fetch after storage signing fails', async () => {
    mocks.signedUrl.mockResolvedValue({ data: null, error: { message: 'private storage failure' } })
    await expect(loadLookAnalysisFrames(photo)).rejects.toThrow('Media unavailable')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects unsuccessful media responses before decoding', async () => {
    mocks.fetch.mockResolvedValue(new Response('not available', { status: 403 }))
    await expect(loadLookAnalysisFrames(photo)).rejects.toThrow('Media unavailable')
  })
})
