import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BUCKETS } from '@/lib/storageBuckets'

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  createSignedUrl: vi.fn(),
  safeUrl: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

vi.mock('@/lib/media', () => ({
  safeUrl: mocks.safeUrl,
}))

describe('lib/media/renderUrls', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co/'
    delete process.env.SUPABASE_URL

    mocks.safeUrl.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null

      const trimmed = value.trim()
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return null
      }

      return trimmed
    })

    mocks.createSignedUrl.mockResolvedValue({
      data: {
        signedUrl: 'https://signed.example/private-main.jpg',
      },
      error: null,
    })

    mocks.getSupabaseAdmin.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mocks.createSignedUrl,
        })),
      },
    })
  })

  async function loadRenderMediaUrls() {
    const mod = await import('./renderUrls')
    return mod.renderMediaUrls
  }

  it('renders media-public storage pointers as public Supabase URLs', async () => {
    const renderMediaUrls = await loadRenderMediaUrls()

    const result = await renderMediaUrls({
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'profiles/pro 1/main image.jpg',
      thumbBucket: BUCKETS.mediaPublic,
      thumbPath: 'profiles/pro 1/thumb image.jpg',
      url: 'https://legacy.example/main.jpg',
      thumbUrl: 'https://legacy.example/thumb.jpg',
    })

    expect(result).toEqual({
      renderUrl:
        'https://project.supabase.co/storage/v1/object/public/media-public/profiles/pro%201/main%20image.jpg',
      renderThumbUrl:
        'https://project.supabase.co/storage/v1/object/public/media-public/profiles/pro%201/thumb%20image.jpg',
    })

    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('renders media-private storage pointers as signed URLs', async () => {
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: {
          signedUrl: 'https://signed.example/private-main.jpg',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          signedUrl: 'https://signed.example/private-thumb.jpg',
        },
        error: null,
      })

    const renderMediaUrls = await loadRenderMediaUrls()

    const result = await renderMediaUrls({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: BUCKETS.mediaPrivate,
      thumbPath: 'bookings/booking_1/before/thumb.jpg',
      url: 'https://legacy.example/private-main.jpg',
      thumbUrl: 'https://legacy.example/private-thumb.jpg',
    })

    expect(mocks.createSignedUrl).toHaveBeenNthCalledWith(
      1,
      'bookings/booking_1/before/main.jpg',
      60 * 10,
    )
    expect(mocks.createSignedUrl).toHaveBeenNthCalledWith(
      2,
      'bookings/booking_1/before/thumb.jpg',
      60 * 10,
    )

    expect(result).toEqual({
      renderUrl: 'https://signed.example/private-main.jpg',
      renderThumbUrl: 'https://signed.example/private-thumb.jpg',
    })
  })

  it('does not fall back to raw url when private signing fails', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: {
        message: 'signing failed',
      },
    })

    const renderMediaUrls = await loadRenderMediaUrls()

    const result = await renderMediaUrls({
      storageBucket: BUCKETS.mediaPrivate,
      storagePath: 'bookings/booking_1/before/main.jpg',
      thumbBucket: BUCKETS.mediaPrivate,
      thumbPath: 'bookings/booking_1/before/thumb.jpg',
      url: 'https://legacy.example/private-main.jpg',
      thumbUrl: 'https://legacy.example/private-thumb.jpg',
    })

    expect(result).toEqual({
      renderUrl: null,
      renderThumbUrl: null,
    })
  })

  it('uses safe legacy urls when no storage pointer is present', async () => {
    const renderMediaUrls = await loadRenderMediaUrls()

    const result = await renderMediaUrls({
      storageBucket: null,
      storagePath: null,
      thumbBucket: null,
      thumbPath: null,
      url: 'https://legacy.example/main.jpg',
      thumbUrl: 'https://legacy.example/thumb.jpg',
    })

    expect(result).toEqual({
      renderUrl: 'https://legacy.example/main.jpg',
      renderThumbUrl: 'https://legacy.example/thumb.jpg',
    })

    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled()
  })

  it('returns null for public storage pointers when Supabase URL env is missing instead of leaking unsafe urls', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_URL

    const renderMediaUrls = await loadRenderMediaUrls()

    const result = await renderMediaUrls({
      storageBucket: BUCKETS.mediaPublic,
      storagePath: 'profiles/pro_1/main.jpg',
      thumbBucket: BUCKETS.mediaPublic,
      thumbPath: 'profiles/pro_1/thumb.jpg',
      url: 'javascript:alert(1)',
      thumbUrl: 'not-a-url',
    })

    expect(result).toEqual({
      renderUrl: null,
      renderThumbUrl: null,
    })
  })

  it('falls back to safe legacy urls for unknown buckets only when urls are safe', async () => {
    const renderMediaUrls = await loadRenderMediaUrls()

    const result = await renderMediaUrls({
      storageBucket: 'unknown-bucket',
      storagePath: 'some/path.jpg',
      thumbBucket: 'unknown-bucket',
      thumbPath: 'some/thumb.jpg',
      url: 'https://legacy.example/main.jpg',
      thumbUrl: 'javascript:alert(1)',
    })

    expect(result).toEqual({
      renderUrl: 'https://legacy.example/main.jpg',
      renderThumbUrl: null,
    })

    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled()
  })
})