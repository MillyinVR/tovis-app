import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  createSignedUrls: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

import {
  MAX_MESSAGE_ATTACHMENTS,
  MESSAGE_ATTACHMENT_BUCKET,
  buildMessageAttachmentPath,
  isMessageAttachmentPathForThread,
  isSupportedAttachmentContentType,
  messageAttachmentPrefix,
  signMessageAttachmentUrls,
} from './attachments'

describe('lib/messages/attachments — validators', () => {
  it('accepts only image content types', () => {
    expect(isSupportedAttachmentContentType('image/jpeg')).toBe(true)
    expect(isSupportedAttachmentContentType('IMAGE/PNG')).toBe(true)
    expect(isSupportedAttachmentContentType('video/mp4')).toBe(false)
    expect(isSupportedAttachmentContentType('application/pdf')).toBe(false)
    expect(isSupportedAttachmentContentType('')).toBe(false)
  })

  it('namespaces the prefix under the thread', () => {
    expect(messageAttachmentPrefix('thread_123')).toBe('messages/thread_123/')
  })

  it('accepts a path inside the thread namespace', () => {
    const path = 'messages/thread_123/user_9/2026-07/1_abc.jpg'
    expect(isMessageAttachmentPathForThread(path, 'thread_123')).toBe(true)
  })

  it('rejects a path from another thread', () => {
    const path = 'messages/thread_999/user_9/2026-07/1_abc.jpg'
    expect(isMessageAttachmentPathForThread(path, 'thread_123')).toBe(false)
  })

  it('rejects traversal, non-strings, and empty', () => {
    expect(
      isMessageAttachmentPathForThread(
        'messages/thread_123/../thread_999/x.jpg',
        'thread_123',
      ),
    ).toBe(false)
    expect(isMessageAttachmentPathForThread(42, 'thread_123')).toBe(false)
    expect(isMessageAttachmentPathForThread('', 'thread_123')).toBe(false)
    expect(isMessageAttachmentPathForThread('avatars/x.jpg', 'thread_123')).toBe(
      false,
    )
  })

  it('builds a unique path under the thread + uploader namespace', () => {
    const path = buildMessageAttachmentPath({
      threadId: 'thread_123',
      userId: 'user_9',
      contentType: 'image/jpeg',
    })
    expect(path.startsWith('messages/thread_123/user_9/')).toBe(true)
    expect(isMessageAttachmentPathForThread(path, 'thread_123')).toBe(true)
    expect(path.endsWith('.jpg')).toBe(true)
  })

  it('caps attachments per message', () => {
    expect(MAX_MESSAGE_ATTACHMENTS).toBeGreaterThan(0)
  })
})

describe('lib/messages/attachments — signMessageAttachmentUrls', () => {
  beforeEach(() => {
    mocks.createSignedUrls.mockReset()
    mocks.getSupabaseAdmin.mockReturnValue({
      storage: {
        from: vi.fn((bucket: string) => {
          expect(bucket).toBe(MESSAGE_ATTACHMENT_BUCKET)
          return { createSignedUrls: mocks.createSignedUrls }
        }),
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps signed URLs back to their paths and drops unsignable ones', async () => {
    mocks.createSignedUrls.mockResolvedValue({
      data: [
        { path: 'messages/t/u/a.jpg', signedUrl: 'https://signed/a' },
        { path: 'messages/t/u/b.jpg', signedUrl: null },
      ],
      error: null,
    })

    const out = await signMessageAttachmentUrls([
      'messages/t/u/a.jpg',
      'messages/t/u/b.jpg',
    ])
    expect(out.get('messages/t/u/a.jpg')).toBe('https://signed/a')
    expect(out.has('messages/t/u/b.jpg')).toBe(false)
  })

  it('returns an empty map when signing errors', async () => {
    mocks.createSignedUrls.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const out = await signMessageAttachmentUrls(['messages/t/u/c.jpg'])
    expect(out.size).toBe(0)
  })

  it('serves a cached URL without re-signing within the TTL', async () => {
    mocks.createSignedUrls.mockResolvedValue({
      data: [{ path: 'messages/t/u/cached.jpg', signedUrl: 'https://signed/cached' }],
      error: null,
    })

    const first = await signMessageAttachmentUrls(['messages/t/u/cached.jpg'])
    expect(first.get('messages/t/u/cached.jpg')).toBe('https://signed/cached')
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1)

    const second = await signMessageAttachmentUrls(['messages/t/u/cached.jpg'])
    expect(second.get('messages/t/u/cached.jpg')).toBe('https://signed/cached')
    // Still one call — the second read hit the cache.
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1)
  })

  it('signs nothing when given no paths', async () => {
    const out = await signMessageAttachmentUrls([])
    expect(out.size).toBe(0)
    expect(mocks.createSignedUrls).not.toHaveBeenCalled()
  })
})
