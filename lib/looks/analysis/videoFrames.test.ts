import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { extractLookVideoFrames } from './videoFrames'

vi.mock('server-only', () => ({}))

let fixtureDir: string
let video: Buffer
const extractionDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('look-video-')).sort()

beforeAll(async () => {
  if (!ffmpegPath) throw new Error('Test requires the packaged decoder')
  fixtureDir = await mkdtemp(join(tmpdir(), 'video-fixture-'))
  const path = join(fixtureDir, 'tiny.mp4')
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc=size=64x48:rate=10', '-t', '1', '-pix_fmt', 'yuv420p', path], { timeout: 10_000 })
  video = await readFile(path)
})
afterAll(async () => { if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true }) })

describe('extractLookVideoFrames', () => {
  it('extracts three real decodable frames across a video and removes temporary files', async () => {
    const before = await extractionDirs()
    const frames = await extractLookVideoFrames(video)
    expect(frames.map((frame) => frame.atSeconds)).toEqual([0, 0.5, 0.9])
    for (const frame of frames) {
      expect(frame.contentType).toBe('image/jpeg')
      expect(await sharp(frame.bytes).metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 48 })
    }
    expect(frames[0]!.bytes.equals(frames[2]!.bytes)).toBe(false)
    expect(await extractionDirs()).toEqual(before)
  })

  it('handles a single-frame clip without claiming later frames exist', async () => {
    if (!ffmpegPath) throw new Error('Decoder missing')
    const path = join(fixtureDir, 'single.mp4')
    execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'color=red:size=32x32:rate=1', '-frames:v', '1', path], { timeout: 10_000 })
    const frames = await extractLookVideoFrames(await readFile(path))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.atSeconds).toBe(0)
  })

  it('rejects an overlong video and removes the private input', async () => {
    if (!ffmpegPath) throw new Error('Decoder missing')
    const path = join(fixtureDir, 'overlong.mp4')
    execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'color=red:size=32x32:rate=1', '-t', '121', path], { timeout: 10_000 })
    const before = await extractionDirs()
    await expect(extractLookVideoFrames(await readFile(path))).rejects.toThrow('120 seconds')
    expect(await extractionDirs()).toEqual(before)
  })

  it('rejects corrupt media and cleans up after decoder failure', async () => {
    const before = await extractionDirs()
    await expect(extractLookVideoFrames(Buffer.from('not a video'))).rejects.toThrow('Video decoding failed')
    expect(await extractionDirs()).toEqual(before)
  })

  it('rejects playlists instead of opening their external media references', async () => {
    const before = await extractionDirs()
    await expect(extractLookVideoFrames(Buffer.from('#EXTM3U\n#EXTINF:5,\nhttps://example.com/video.ts\n'))).rejects.toThrow('Video decoding failed')
    expect(await extractionDirs()).toEqual(before)
  })

  it('rejects empty or oversized input before starting a decoder', async () => {
    await expect(extractLookVideoFrames(new Uint8Array())).rejects.toThrow('between 1 byte and 100 MB')
    await expect(extractLookVideoFrames(new Uint8Array(100 * 1024 * 1024 + 1))).rejects.toThrow('between 1 byte and 100 MB')
  })
})
