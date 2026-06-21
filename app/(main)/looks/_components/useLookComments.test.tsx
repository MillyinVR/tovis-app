// app/(main)/looks/_components/useLookComments.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLookComments } from './useLookComments'
import type { UiComment } from './lookTypes'

function comment(overrides?: Partial<UiComment>): UiComment {
  return {
    id: 'comment_1',
    body: 'Existing comment',
    createdAt: '2026-04-20T18:00:00.000Z',
    user: { id: 'user_1', displayName: 'Tori Morales', avatarUrl: null },
    parentCommentId: null,
    likeCount: 2,
    replyCount: 0,
    viewerLiked: false,
    viewerCanDelete: true,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FetchHandler = (url: string, method: string) => Response
let handler: FetchHandler

function renderCommentsHook() {
  const onCountChange = vi.fn()
  const onRequireAuth = vi.fn()
  const rendered = renderHook(() =>
    useLookComments({
      lookPostId: 'look_1',
      onCountChange,
      onRequireAuth,
    }),
  )
  return { ...rendered, onCountChange, onRequireAuth }
}

describe('useLookComments', () => {
  beforeEach(() => {
    handler = (url, method) => {
      if (url.endsWith('/comments') && method === 'GET') {
        return jsonResponse({
          lookPostId: 'look_1',
          comments: [comment()],
          commentsCount: 1,
        })
      }
      return jsonResponse({ ok: false }, 500)
    }

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(handler(String(input), init?.method ?? 'GET')),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads top-level comments on open and reports the count', async () => {
    const { result, onCountChange } = renderCommentsHook()

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.comments).toHaveLength(1)
    expect(result.current.commentsCount).toBe(1)
    expect(onCountChange).toHaveBeenCalledWith('look_1', 1)
  })

  it('posts a top-level comment, prepends it, and syncs the count', async () => {
    const { result, onCountChange } = renderCommentsHook()
    await waitFor(() => expect(result.current.loading).toBe(false))

    handler = (url, method) => {
      if (url.endsWith('/comments') && method === 'POST') {
        return jsonResponse(
          {
            lookPostId: 'look_1',
            comment: comment({ id: 'comment_new', body: 'Fresh take' }),
            commentsCount: 2,
          },
          201,
        )
      }
      return jsonResponse({ ok: false }, 500)
    }

    act(() => result.current.setText('Fresh take'))
    await act(async () => {
      await result.current.post()
    })

    expect(result.current.comments[0]?.id).toBe('comment_new')
    expect(result.current.commentsCount).toBe(2)
    expect(result.current.text).toBe('')
    expect(onCountChange).toHaveBeenLastCalledWith('look_1', 2)
  })

  it('optimistically flips a like and reconciles with the server count', async () => {
    const { result } = renderCommentsHook()
    await waitFor(() => expect(result.current.loading).toBe(false))

    handler = (url, method) => {
      if (url.endsWith('/comment_1/like') && method === 'POST') {
        return jsonResponse({
          lookPostId: 'look_1',
          commentId: 'comment_1',
          liked: true,
          likeCount: 3,
        })
      }
      return jsonResponse({ ok: false }, 500)
    }

    await act(async () => {
      await result.current.toggleLike(result.current.comments[0]!)
    })

    expect(result.current.comments[0]?.viewerLiked).toBe(true)
    expect(result.current.comments[0]?.likeCount).toBe(3)
  })

  it('rolls a like back to its prior state when the server rejects it', async () => {
    const { result } = renderCommentsHook()
    await waitFor(() => expect(result.current.loading).toBe(false))

    handler = () => jsonResponse({ ok: false }, 500)

    await act(async () => {
      await result.current.toggleLike(result.current.comments[0]!)
    })

    expect(result.current.comments[0]?.viewerLiked).toBe(false)
    expect(result.current.comments[0]?.likeCount).toBe(2)
  })

  it('removes a comment optimistically and syncs the count from the server', async () => {
    const { result, onCountChange } = renderCommentsHook()
    await waitFor(() => expect(result.current.loading).toBe(false))

    handler = (url, method) => {
      if (url.endsWith('/comment_1') && method === 'DELETE') {
        return jsonResponse({
          lookPostId: 'look_1',
          commentId: 'comment_1',
          deleted: true,
          commentsCount: 0,
        })
      }
      return jsonResponse({ ok: false }, 500)
    }

    await act(async () => {
      await result.current.remove(result.current.comments[0]!)
    })

    expect(result.current.comments).toHaveLength(0)
    expect(onCountChange).toHaveBeenLastCalledWith('look_1', 0)
  })

  it('redirects to auth when a guest tries to post', async () => {
    const { result, onRequireAuth } = renderCommentsHook()
    await waitFor(() => expect(result.current.loading).toBe(false))

    handler = (url, method) => {
      if (url.endsWith('/comments') && method === 'POST') {
        return jsonResponse({ ok: false }, 401)
      }
      return jsonResponse({ ok: false }, 500)
    }

    act(() => result.current.setText('Hi'))
    await act(async () => {
      await result.current.post()
    })

    expect(onRequireAuth).toHaveBeenCalledWith('comment')
  })
})
