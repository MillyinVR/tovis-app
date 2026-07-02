import 'server-only'

import { MediaType } from '@prisma/client'

import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pickString } from '@/lib/pick'

/**
 * The chosen "before" of an opt-in before/after pair, resolved to renderable
 * URLs. Present on a displayed asset (portfolio tile / review after-photo) that
 * a pro or client paired; null → render the asset as a single tile. The tile's
 * own `src`/`thumbUrl` are the "after".
 */
export type PairedBeforeDto = {
  id: string
  thumbUrl: string | null
  fullUrl: string | null
}

type PairedBeforeAssetInput = {
  id: string
  mediaType: MediaType
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}

/**
 * Resolve a paired "before" asset to renderable URLs, or null when there's no
 * pairing (or the counterpart is a video / has no usable URL). Shared by the
 * portfolio and review mappers so the before/after slider gets the same data
 * shape everywhere.
 */
export async function mapPairedBeforeToDto(
  beforeAsset: PairedBeforeAssetInput | null,
): Promise<PairedBeforeDto | null> {
  if (!beforeAsset) return null
  if (beforeAsset.mediaType !== MediaType.IMAGE) return null

  let url = pickString(beforeAsset.url)
  let thumbUrl = pickString(beforeAsset.thumbUrl)

  if (
    (!url || !thumbUrl) &&
    pickString(beforeAsset.storageBucket) &&
    pickString(beforeAsset.storagePath)
  ) {
    const rendered = await renderMediaUrls({
      storageBucket: beforeAsset.storageBucket,
      storagePath: beforeAsset.storagePath,
      thumbBucket: beforeAsset.thumbBucket,
      thumbPath: beforeAsset.thumbPath,
      url: beforeAsset.url,
      thumbUrl: beforeAsset.thumbUrl,
    })

    url = pickString(rendered.renderUrl) ?? url
    thumbUrl = pickString(rendered.renderThumbUrl) ?? thumbUrl
  }

  const fullUrl = url ?? thumbUrl
  const thumb = thumbUrl ?? url
  if (!fullUrl && !thumb) return null

  return { id: beforeAsset.id, thumbUrl: thumb, fullUrl }
}
