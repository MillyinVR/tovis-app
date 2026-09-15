import 'server-only'
import sharp from 'sharp'
import { MediaType } from '@prisma/client'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { normalizeImageForVision } from '@/lib/media/normalizeImage'
import { resolveCropRect } from '@/lib/media/cropRect'
import type { LookAnalysisAsset } from './identity'
import type { LookAnalysisFrame } from './reading'
import { extractLookVideoFrames } from './videoFrames'

export async function loadLookAnalysisFrames(asset: LookAnalysisAsset): Promise<LookAnalysisFrame[]> {
  // Server-owned storage pointers only. Limit BEFORE buffering and during streaming.
  const { data, error } = await getSupabaseAdmin().storage.from(asset.storageBucket).createSignedUrl(asset.storagePath, 60)
  if (error || !data?.signedUrl) throw new Error('Media unavailable')
  const response = await fetch(data.signedUrl, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
  if (!response.ok || !response.body) throw new Error('Media unavailable')
  const limit = asset.mediaType === MediaType.VIDEO ? 100 * 1024 * 1024 : 25 * 1024 * 1024
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > limit) throw new Error('Media exceeds analysis limit')
      chunks.push(part.value)
    }
  } finally { await reader.cancel() }
  const bytes = Buffer.concat(chunks)
  const source = asset.mediaType === MediaType.VIDEO ? await extractLookVideoFrames(bytes) : [{ atSeconds: 0, bytes, contentType: 'image/jpeg' as const }]
  const crop = resolveCropRect(asset.cropX, asset.cropY, asset.cropW, asset.cropH)
  if ([asset.cropX, asset.cropY, asset.cropW, asset.cropH].some(value => value !== null) && !crop) throw new Error('Invalid published crop')
  return Promise.all(source.map(async frame => {
    // Orientation first: stored crop coordinates refer to the upright image.
    const upright = await sharp(frame.bytes, { limitInputPixels: 40_000_000 }).rotate().withIccProfile('srgb').toBuffer()
    const metadata = await sharp(upright).metadata()
    if (!metadata.width || !metadata.height) throw new Error('Invalid image dimensions')
    let image = sharp(upright)
    if (crop) {
      const left = Math.floor(crop.x * metadata.width), top = Math.floor(crop.y * metadata.height)
      image = image.extract({ left, top, width: Math.max(1, Math.min(metadata.width - left, Math.floor(crop.w * metadata.width))), height: Math.max(1, Math.min(metadata.height - top, Math.floor(crop.h * metadata.height))) })
    }
    const jpeg = await image.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).withIccProfile('srgb').jpeg({ quality: 85 }).toBuffer()
    const normalized = await normalizeImageForVision(jpeg, 'image/jpeg')
    return { atSeconds: frame.atSeconds, base64: normalized.bytes.toString('base64'), mediaType: 'image/jpeg' as const }
  }))
}
