import { describe, expect, it } from 'vitest'

import { BUCKETS } from '@/lib/storageBuckets'

import {
  IMAGE_VARIANTS,
  encodeStoragePath,
  publicObjectUrl,
  transformedImageUrl,
} from './imageTransform'

const BASE = 'https://project.supabase.co'

function feedUrl(path: string, bucket: string = BUCKETS.mediaPublic) {
  return transformedImageUrl({ baseUrl: BASE, bucket, path, variant: 'feed' })
}

describe('lib/media/imageTransform', () => {
  describe('transformedImageUrl', () => {
    // 🔴 The load-bearing test. `?width=1080` alone returns 1080×4032 from a
    // 3024×4032 source — a stretched photograph with a byte count that looks
    // like a win. If this assertion ever goes missing, the feed silently starts
    // shipping distorted looks.
    it('always sends resize=contain', () => {
      const url = feedUrl('looks/a.jpg')
      expect(url).not.toBeNull()
      expect(new URL(url!).searchParams.get('resize')).toBe('contain')
    })

    it('every named variant sends resize=contain', () => {
      for (const variant of Object.keys(IMAGE_VARIANTS) as Array<
        keyof typeof IMAGE_VARIANTS
      >) {
        const url = transformedImageUrl({
          baseUrl: BASE,
          bucket: BUCKETS.mediaPublic,
          path: 'looks/a.jpg',
          variant,
        })
        expect(url, variant).not.toBeNull()
        expect(new URL(url!).searchParams.get('resize'), variant).toBe('contain')
      }
    })

    it('points at the render endpoint, not the object endpoint', () => {
      expect(feedUrl('looks/a.jpg')).toContain(
        '/storage/v1/render/image/public/media-public/looks/a.jpg',
      )
      expect(feedUrl('looks/a.jpg')).not.toContain('/storage/v1/object/')
    })

    it('carries the variant width and quality', () => {
      const feed = new URL(feedUrl('looks/a.jpg')!)
      expect(feed.searchParams.get('width')).toBe('1080')
      expect(feed.searchParams.get('quality')).toBe('70')

      const tile = new URL(
        transformedImageUrl({
          baseUrl: BASE,
          bucket: BUCKETS.mediaPublic,
          path: 'looks/a.jpg',
          variant: 'tile',
        })!,
      )
      expect(tile.searchParams.get('width')).toBe('512')
      expect(tile.searchParams.get('quality')).toBe('68')
    })

    // A tile is the grid variant precisely because a feed-sized tile on a
    // 60-cell grid is 17 MB again.
    it('sizes a tile well below a feed slide', () => {
      expect(IMAGE_VARIANTS.tile.width).toBeLessThan(IMAGE_VARIANTS.feed.width)
    })

    it('percent-encodes each path segment but keeps the separators', () => {
      const url = feedUrl('pro/pro 1/look #2.jpg')
      expect(url).toContain('/media-public/pro/pro%201/look%20%232.jpg?')
    })

    it('refuses a private bucket', () => {
      expect(feedUrl('clients/a.jpg', BUCKETS.mediaPrivate)).toBeNull()
    })

    it('refuses an unknown bucket', () => {
      expect(feedUrl('a.jpg', 'some-other-bucket')).toBeNull()
    })

    it('refuses a missing base URL or path', () => {
      expect(
        transformedImageUrl({
          baseUrl: null,
          bucket: BUCKETS.mediaPublic,
          path: 'a.jpg',
          variant: 'feed',
        }),
      ).toBeNull()
      expect(feedUrl('')).toBeNull()
    })
  })

  describe('publicObjectUrl', () => {
    it('builds the stored-object URL with the same encoding', () => {
      expect(publicObjectUrl(BASE, BUCKETS.mediaPublic, 'pro/pro 1/a.jpg')).toBe(
        'https://project.supabase.co/storage/v1/object/public/media-public/pro/pro%201/a.jpg',
      )
    })

    it('returns null when any part is missing', () => {
      expect(publicObjectUrl('', BUCKETS.mediaPublic, 'a.jpg')).toBeNull()
      expect(publicObjectUrl(BASE, '', 'a.jpg')).toBeNull()
      expect(publicObjectUrl(BASE, BUCKETS.mediaPublic, '')).toBeNull()
    })
  })

  describe('encodeStoragePath', () => {
    it('does not escape the separators', () => {
      expect(encodeStoragePath('a/b c/d.jpg')).toBe('a/b%20c/d.jpg')
    })
  })
})
