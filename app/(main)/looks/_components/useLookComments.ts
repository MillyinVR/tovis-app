// app/(main)/looks/_components/useLookComments.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { asTrimmedString, isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'
import {
  parseLooksComment,
  parseLooksCommentRepliesResponse,
  parseLooksCommentsResponse,
} from '@/lib/looks/parsers'
import type { UiComment } from './lookTypes'

export type ReplyTarget = {
  // The top-level comment the reply attaches to (server flattens threads).
  parentId: string
  // Whose comment is being answered — drives the "@name" affordance.
  displayName: string
}

export type CommentThread = {
  open: boolean
  loading: boolean
  loaded: boolean
  error: string | null
  replies: UiComment[]
}

const EMPTY_THREAD: CommentThread = {
  open: false,
  loading: false,
  loaded: false,
  error: null,
  replies: [],
}

function isGuestBlocked(status: number) {
  return status === 401
}

function errorMessage(raw: unknown, fallback: string): string {
  return asTrimmedString(isRecord(raw) ? raw.error : null) ?? fallback
}

export function useLookComments(args: {
  lookPostId: string | null
  onCountChange: (lookPostId: string, commentsCount: number) => void
  onRequireAuth: (reason: string) => void
}) {
  const { lookPostId, onCountChange, onRequireAuth } = args

  const [comments, setComments] = useState<UiComment[]>([])
  const [commentsCount, setCommentsCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)

  const [threads, setThreads] = useState<Record<string, CommentThread>>({})

  const likeInFlight = useRef<Record<string, boolean>>({})
  const loadAbortRef = useRef<AbortController | null>(null)

  const getThread = useCallback(
    (parentId: string): CommentThread => threads[parentId] ?? EMPTY_THREAD,
    [threads],
  )

  const syncCount = useCallback(
    (id: string, count: number) => {
      setCommentsCount(count)
      onCountChange(id, count)
    },
    [onCountChange],
  )

  // Load top-level comments whenever the sheet opens for a look.
  useEffect(() => {
    if (!lookPostId) return

    setComments([])
    setThreads({})
    setReplyTo(null)
    setText('')
    setError(null)
    setLoading(true)

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    void (async () => {
      try {
        const res = await fetch(`/api/v1/looks/${lookPostId}/comments`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        const raw = await safeJson(res)
        if (controller.signal.aborted) return

        if (isGuestBlocked(res.status)) {
          onRequireAuth('comment')
          return
        }

        if (!res.ok) {
          throw new Error(errorMessage(raw, 'Failed to load comments'))
        }

        setComments(parseLooksCommentsResponse(raw))
        const count = isRecord(raw) && typeof raw.commentsCount === 'number'
          ? raw.commentsCount
          : 0
        setCommentsCount(count)
        onCountChange(lookPostId, count)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load comments')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [lookPostId, onCountChange, onRequireAuth])

  const toggleReplies = useCallback(
    async (parentId: string) => {
      if (!lookPostId) return

      const current = threads[parentId] ?? EMPTY_THREAD

      // Already loaded → just flip visibility.
      if (current.loaded || current.open) {
        setThreads((prev) => ({
          ...prev,
          [parentId]: {
            ...(prev[parentId] ?? EMPTY_THREAD),
            open: !(prev[parentId] ?? EMPTY_THREAD).open,
          },
        }))
        if (current.loaded) return
      }

      setThreads((prev) => ({
        ...prev,
        [parentId]: {
          ...(prev[parentId] ?? EMPTY_THREAD),
          open: true,
          loading: true,
          error: null,
        },
      }))

      try {
        const res = await fetch(
          `/api/v1/looks/${lookPostId}/comments/${parentId}/replies`,
          { cache: 'no-store', headers: { Accept: 'application/json' } },
        )
        const raw = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          onRequireAuth('comment')
          return
        }

        if (!res.ok) {
          throw new Error(errorMessage(raw, 'Failed to load replies'))
        }

        setThreads((prev) => ({
          ...prev,
          [parentId]: {
            open: true,
            loading: false,
            loaded: true,
            error: null,
            replies: parseLooksCommentRepliesResponse(raw),
          },
        }))
      } catch (e) {
        setThreads((prev) => ({
          ...prev,
          [parentId]: {
            ...(prev[parentId] ?? EMPTY_THREAD),
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load replies',
          },
        }))
      }
    },
    [lookPostId, threads, onRequireAuth],
  )

  const post = useCallback(async () => {
    if (!lookPostId || posting) return

    const body = text.trim()
    if (!body) return

    const target = replyTo
    setPosting(true)
    setError(null)

    try {
      const res = await fetch(`/api/v1/looks/${lookPostId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          body,
          ...(target ? { parentCommentId: target.parentId } : {}),
        }),
      })
      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        onRequireAuth('comment')
        return
      }

      if (!res.ok) {
        setError(errorMessage(raw, 'Failed to post comment'))
        return
      }

      const created = parseLooksComment(isRecord(raw) ? raw.comment : null)
      const count = isRecord(raw) && typeof raw.commentsCount === 'number'
        ? raw.commentsCount
        : commentsCount + 1

      if (created) {
        if (target) {
          // Reply: drop it into its (now-open) thread and bump the parent's
          // reply tally.
          setComments((prev) =>
            prev.map((c) =>
              c.id === target.parentId
                ? { ...c, replyCount: c.replyCount + 1 }
                : c,
            ),
          )
          setThreads((prev) => {
            const existing = prev[target.parentId] ?? EMPTY_THREAD
            return {
              ...prev,
              [target.parentId]: {
                ...existing,
                open: true,
                loaded: true,
                replies: [...existing.replies, created],
              },
            }
          })
        } else {
          setComments((prev) => [created, ...prev])
        }
      }

      syncCount(lookPostId, count)
      setText('')
      setReplyTo(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }, [lookPostId, posting, text, replyTo, commentsCount, syncCount, onRequireAuth])

  const toggleLike = useCallback(
    async (comment: UiComment) => {
      if (!lookPostId) return
      if (likeInFlight.current[comment.id]) return
      likeInFlight.current[comment.id] = true

      const wasLiked = comment.viewerLiked
      const parentId = comment.parentCommentId

      const patch = (liked: boolean, likeCount: number) => {
        if (parentId) {
          setThreads((prev) => {
            const existing = prev[parentId]
            if (!existing) return prev
            return {
              ...prev,
              [parentId]: {
                ...existing,
                replies: existing.replies.map((r) =>
                  r.id === comment.id ? { ...r, viewerLiked: liked, likeCount } : r,
                ),
              },
            }
          })
        } else {
          setComments((prev) =>
            prev.map((c) =>
              c.id === comment.id ? { ...c, viewerLiked: liked, likeCount } : c,
            ),
          )
        }
      }

      // Optimistic flip.
      patch(!wasLiked, Math.max(0, comment.likeCount + (wasLiked ? -1 : 1)))

      try {
        const res = await fetch(
          `/api/v1/looks/${lookPostId}/comments/${comment.id}/like`,
          { method: wasLiked ? 'DELETE' : 'POST' },
        )
        const raw = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          patch(wasLiked, comment.likeCount)
          onRequireAuth('comment')
          return
        }

        if (!res.ok) {
          patch(wasLiked, comment.likeCount)
          return
        }

        const liked = isRecord(raw) && typeof raw.liked === 'boolean'
          ? raw.liked
          : !wasLiked
        const likeCount = isRecord(raw) && typeof raw.likeCount === 'number'
          ? raw.likeCount
          : comment.likeCount
        patch(liked, likeCount)
      } finally {
        likeInFlight.current[comment.id] = false
      }
    },
    [lookPostId, onRequireAuth],
  )

  const remove = useCallback(
    async (comment: UiComment) => {
      if (!lookPostId) return

      const parentId = comment.parentCommentId

      // Optimistic removal; snapshot for rollback.
      const prevComments = comments
      const prevThreads = threads

      if (parentId) {
        setThreads((prev) => {
          const existing = prev[parentId]
          if (!existing) return prev
          return {
            ...prev,
            [parentId]: {
              ...existing,
              replies: existing.replies.filter((r) => r.id !== comment.id),
            },
          }
        })
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId
              ? { ...c, replyCount: Math.max(0, c.replyCount - 1) }
              : c,
          ),
        )
      } else {
        setComments((prev) => prev.filter((c) => c.id !== comment.id))
        setThreads((prev) => {
          if (!(comment.id in prev)) return prev
          const rest = { ...prev }
          delete rest[comment.id]
          return rest
        })
      }

      try {
        const res = await fetch(
          `/api/v1/looks/${lookPostId}/comments/${comment.id}`,
          { method: 'DELETE', headers: { Accept: 'application/json' } },
        )
        const raw = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          setComments(prevComments)
          setThreads(prevThreads)
          onRequireAuth('comment')
          return
        }

        if (!res.ok) {
          setComments(prevComments)
          setThreads(prevThreads)
          setError(errorMessage(raw, 'Failed to delete comment'))
          return
        }

        const count = isRecord(raw) && typeof raw.commentsCount === 'number'
          ? raw.commentsCount
          : Math.max(0, commentsCount - 1)
        syncCount(lookPostId, count)
      } catch (e) {
        setComments(prevComments)
        setThreads(prevThreads)
        setError(e instanceof Error ? e.message : 'Failed to delete comment')
      }
    },
    [lookPostId, comments, threads, commentsCount, syncCount, onRequireAuth],
  )

  const report = useCallback(
    async (comment: UiComment): Promise<'ok' | 'auth' | 'error'> => {
      if (!lookPostId) return 'error'
      try {
        const res = await fetch(
          `/api/v1/looks/${lookPostId}/comments/${comment.id}/report`,
          { method: 'POST', headers: { Accept: 'application/json' } },
        )
        if (isGuestBlocked(res.status)) {
          onRequireAuth('comment')
          return 'auth'
        }
        return res.ok ? 'ok' : 'error'
      } catch {
        return 'error'
      }
    },
    [lookPostId, onRequireAuth],
  )

  return {
    comments,
    commentsCount,
    loading,
    error,
    text,
    setText,
    posting,
    replyTo,
    setReplyTo,
    getThread,
    toggleReplies,
    post,
    toggleLike,
    remove,
    report,
  }
}
