import 'server-only'

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

const MAX_INPUT_BYTES = 100 * 1024 * 1024
const MAX_DURATION_SECONDS = 120
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 8_000

function run(args: string[]): Promise<{ stdout: Buffer; stderr: Buffer }> {
  if (!ffmpegPath) throw new Error('Video decoder unavailable on this platform.')
  const executable = ffmpegPath
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      encoding: 'buffer', timeout: PROCESS_TIMEOUT_MS, killSignal: 'SIGKILL',
      maxBuffer: MAX_FRAME_BYTES, windowsHide: true,
    }, (error, stdout, stderr) => {
      // Decoder output can contain media metadata; never surface it to callers.
      if (error) reject(new Error('Video decoding failed or exceeded its processing limit.'))
      else resolve({ stdout, stderr })
    })
  })
}

/** Samples a short uploaded video, not every scene or its complete contents. */
export async function extractLookVideoFrames(bytes: Uint8Array): Promise<Array<{
  atSeconds: number
  bytes: Buffer
  contentType: 'image/jpeg'
}>> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error('Video must contain between 1 byte and 100 MB.')
  }
  const directory = await mkdtemp(join(tmpdir(), 'look-video-'))
  try {
    const input = join(directory, 'input')
    await writeFile(input, bytes, { mode: 0o600, flag: 'wx' })
    // No playlist/image demuxers, external data references, URLs or caller paths.
    const inputArgs = [
      '-hide_banner', '-nostdin', '-threads', '1', '-filter_threads', '1',
      '-max_alloc', '67108864', '-protocol_whitelist', 'file',
      '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-i', input,
    ]
    const probe = await run([...inputArgs, '-map', '0:v:0', '-t', '0', '-f', 'null', '-'])
    const durationMatch = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr.toString('utf8'))
    if (!durationMatch) throw new Error('Video duration could not be verified.')
    const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
      throw new Error('Video must be no longer than 120 seconds.')
    }
    const frames: Array<{ atSeconds: number; bytes: Buffer; contentType: 'image/jpeg' }> = []
    for (const fraction of [0, 0.5, 0.9]) {
      const atSeconds = duration * fraction
      const result = await run([
        ...inputArgs, '-ss', atSeconds.toFixed(6), '-map', '0:v:0', '-an', '-sn', '-dn',
        '-frames:v', '1', '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease",
        '-threads', '1', '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1',
      ])
      // Very short / low-frame-rate clips may have no frame after a later seek.
      if (result.stdout.length === 0) continue
      if (result.stdout.length < 4 || result.stdout[0] !== 0xff || result.stdout[1] !== 0xd8 ||
          result.stdout[result.stdout.length - 2] !== 0xff || result.stdout[result.stdout.length - 1] !== 0xd9) {
        throw new Error('Video did not produce a complete image frame.')
      }
      frames.push({ atSeconds, bytes: result.stdout, contentType: 'image/jpeg' })
    }
    if (frames.length === 0) throw new Error('Video did not produce any image frames.')
    return frames
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
