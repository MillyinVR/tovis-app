// app/messages/thread/[id]/ThreadClient.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { useLiveChannels } from '@/app/_components/live/useLiveChannels'
import { DEFAULT_TIME_ZONE, formatInTimeZone, getViewerTimeZone } from '@/lib/time'
import { THREAD_MESSAGE_PAGE_SIZE } from '@/lib/messages/paging'
import { uploadWithProgress } from '@/lib/media/uploadWithProgress'
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/media/uploadLimits'
import { isRecord } from '@/lib/guards'

type Attachment = {
  id: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
}

type Msg = {
  id: string
  body: string | null
  createdAt: string
  senderUserId: string
  attachments: Attachment[]
  /**
   * Set only on locally-created (optimistic) messages the server hasn't yet
   * acked. `sending` = POST in flight; `failed` = POST failed, offer a retry.
   * Server messages omit it. `clientId` correlates the optimistic row with its
   * eventual server message so polling never duplicates it.
   */
  status?: 'sending' | 'failed'
  clientId?: string
  /**
   * On an optimistic message that carries image attachments, the media-private
   * storage paths already uploaded for them — so a retry re-POSTs without having
   * to re-upload the bytes. Server messages omit it.
   */
  retryAttachmentPaths?: string[]
}

type ThreadClientProps = {
  threadId: string
  myUserId: string
  /**
   * This viewer's live-sync channel (`user:{id}`). The send route pings the
   * OTHER participant's channel, so a broadcast here means the counterparty
   * just sent — refetch immediately instead of waiting for the poll. Null when
   * live-sync isn't configured, in which case the poll/focus refresh still run.
   */
  liveChannel: string | null
  initialMessages: Msg[]
  initialCounterpartyLastReadAt: string | null
  /**
   * Cursor for the next-older page (the oldest loaded message's id), or null
   * when the whole history fit in the initial page. Seeds "load earlier".
   */
  initialNextCursor: string | null
  /** Whether there are older messages to page back through. */
  initialHasMore: boolean
}

function isAttachmentMediaType(value: unknown): value is Attachment['mediaType'] {
  return value === 'IMAGE' || value === 'VIDEO'
}

function parseAttachment(value: unknown): Attachment | null {
  if (!isRecord(value)) return null

  const id = value.id
  const url = value.url
  const mediaType = value.mediaType

  if (typeof id !== 'string') return null
  if (typeof url !== 'string') return null
  if (!isAttachmentMediaType(mediaType)) return null

  return { id, url, mediaType }
}

function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return []

  const attachments: Attachment[] = []

  for (const item of value) {
    const attachment = parseAttachment(item)

    if (attachment) {
      attachments.push(attachment)
    }
  }

  return attachments
}

function parseMessage(value: unknown): Msg | null {
  if (!isRecord(value)) return null

  const id = value.id
  const body = value.body
  const createdAt = value.createdAt
  const senderUserId = value.senderUserId

  if (typeof id !== 'string') return null
  if (body !== null && typeof body !== 'string') return null
  if (typeof createdAt !== 'string') return null
  if (typeof senderUserId !== 'string') return null

  return {
    id,
    body,
    createdAt,
    senderUserId,
    attachments: parseAttachments(value.attachments),
  }
}

function parseMessages(value: unknown): Msg[] {
  if (!Array.isArray(value)) return []

  const messages: Msg[] = []

  for (const item of value) {
    const message = parseMessage(item)

    if (message) {
      messages.push(message)
    }
  }

  return messages
}

function parseErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback

  const error = value.error

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return fallback
}

function parseFetchMessagesResponse(
  value: unknown,
): { messages: Msg[]; counterpartyLastReadAt: string | null } | null {
  if (!isRecord(value)) return null
  if (value.ok !== true) return null

  const thread = isRecord(value.thread) ? value.thread : null
  const counterpartyLastReadAt =
    thread && typeof thread.counterpartyLastReadAt === 'string'
      ? thread.counterpartyLastReadAt
      : null

  return { messages: parseMessages(value.messages), counterpartyLastReadAt }
}

function parseOlderPageResponse(
  value: unknown,
): { messages: Msg[]; nextCursor: string | null; hasMore: boolean } | null {
  if (!isRecord(value)) return null
  if (value.ok !== true) return null

  const nextCursor = typeof value.nextCursor === 'string' ? value.nextCursor : null
  const hasMore = value.hasMore === true

  return { messages: parseMessages(value.messages), nextCursor, hasMore }
}

// Union two server-message lists by id (fresh wins) and sort ascending by
// createdAt, id as a stable tiebreak. Used to fold a freshly-fetched page
// (latest poll or an older page) into the loaded set without dropping either
// end — so paging back and then polling never discards loaded history.
function mergeServerMessages(existing: Msg[], incoming: Msg[]): Msg[] {
  const byId = new Map<string, Msg>()
  for (const message of existing) byId.set(message.id, message)
  for (const message of incoming) byId.set(message.id, message)

  return Array.from(byId.values()).sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function parseSendMessageResponse(value: unknown): Msg | null {
  if (!isRecord(value)) return null
  if (value.ok !== true) return null

  return parseMessage(value.message)
}

async function readJsonResponse(res: Response): Promise<unknown> {
  return await res.json().catch(() => null)
}

function formatTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return formatInTimeZone(date, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Stable per-day key (viewer TZ) for grouping — locale-formatted but only ever
// compared for equality, never displayed.
function dayKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatInTimeZone(date, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

// Human day-separator label: "Today" / "Yesterday" / "Mon, Jul 7".
function dayLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const key = dayKey(value)
  const now = new Date()
  if (key === dayKey(now.toISOString())) return 'Today'
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday'

  return formatInTimeZone(date, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function classNames(values: (string | false | null | undefined)[]): string {
  const classes: string[] = []

  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      classes.push(value)
    }
  }

  return classes.join(' ')
}

function messageListsHaveSameTail(current: Msg[], next: Msg[]): boolean {
  const currentLast = current[current.length - 1]?.id ?? null
  const nextLast = next[next.length - 1]?.id ?? null

  return current.length === next.length && currentLast === nextLast
}

function AttachmentPreview(props: { attachment: Attachment }) {
  const { attachment } = props

  if (attachment.mediaType === 'IMAGE') {
    return (
      <RemoteImage
        src={attachment.url ?? ''}
        alt="Image attachment"
        className="mt-2 max-h-56 rounded-[18px] border border-textPrimary/10 object-cover"
        intrinsic
      />
    )
  }

  return (
    <video
      src={attachment.url}
      controls
      className="mt-2 max-h-56 rounded-[18px] border border-textPrimary/10"
    />
  )
}

export default function ThreadClient(props: ThreadClientProps) {
  const {
    threadId,
    myUserId,
    liveChannel,
    initialMessages,
    initialCounterpartyLastReadAt,
    initialNextCursor,
    initialHasMore,
  } = props

  const [messages, setMessages] = useState<Msg[]>(initialMessages)
  const [counterpartyLastReadAt, setCounterpartyLastReadAt] = useState<
    string | null
  >(initialCounterpartyLastReadAt)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // A single image staged in the composer, previewed via a local object URL
  // until it's uploaded + sent. (One attachment per message for now.)
  const [pendingImage, setPendingImage] = useState<{
    file: File
    previewUrl: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // "Load earlier" cursor paging. `olderCursor` is the oldest loaded message's
  // id; the latest-poll never touches it (it only fetches the newest page).
  const [olderCursor, setOlderCursor] = useState<string | null>(initialNextCursor)
  const [hasMoreOlder, setHasMoreOlder] = useState(initialHasMore)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cancelledRef = useRef(false)
  const inFlightRef = useRef(false)

  const trimmedText = text.trim()

  const lastId = useMemo(
    () => messages[messages.length - 1]?.id ?? null,
    [messages],
  )

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [])

  const markRead = useCallback(async () => {
    try {
      await fetch(`/api/v1/messages/threads/${encodeURIComponent(threadId)}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      // Non-blocking. Read receipts should never break the thread UI.
    }
  }, [threadId])

  const fetchLatest = useCallback(async () => {
    if (cancelledRef.current) return
    if (inFlightRef.current) return

    inFlightRef.current = true
    setLoading(true)

    try {
      const res = await fetch(
        `/api/v1/messages/threads/${encodeURIComponent(threadId)}`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      )

      const data = await readJsonResponse(res)
      const fetched = parseFetchMessagesResponse(data)

      if (!res.ok || !fetched) {
        setErr(parseErrorMessage(data, 'Could not refresh messages.'))
        return
      }

      setCounterpartyLastReadAt(fetched.counterpartyLastReadAt)

      setMessages((current) => {
        // Keep locally-pending/failed sends (not yet on the server) tacked on
        // the end so a poll never drops an in-flight or failed bubble.
        const localPending = current.filter((message) => message.status)
        const serverOnly = current.filter((message) => !message.status)
        // Fold the latest page into the loaded set instead of replacing it, so
        // any older pages the user loaded via "load earlier" survive the poll.
        const merged = mergeServerMessages(serverOnly, fetched.messages)
        const serverTailChanged = !messageListsHaveSameTail(serverOnly, merged)

        if (
          localPending.length === 0 &&
          !serverTailChanged &&
          merged.length === serverOnly.length
        ) {
          return current
        }

        if (serverTailChanged) {
          queueMicrotask(() => scrollToBottom('auto'))
        }

        return [...merged, ...localPending]
      })

      void markRead()
      setErr(null)
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [markRead, scrollToBottom, threadId])

  // Page backwards through history. Fetches the messages older than the current
  // oldest-loaded cursor and prepends them, preserving the scroll position so
  // the view doesn't jump (the container grows upward). Never scrolls to bottom.
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || !olderCursor) return

    setLoadingOlder(true)

    const container = scrollRef.current
    const prevHeight = container?.scrollHeight ?? 0
    const prevTop = container?.scrollTop ?? 0

    try {
      const res = await fetch(
        `/api/v1/messages/threads/${encodeURIComponent(threadId)}?cursor=${encodeURIComponent(
          olderCursor,
        )}&take=${THREAD_MESSAGE_PAGE_SIZE}`,
        { method: 'GET', cache: 'no-store' },
      )

      const data = await readJsonResponse(res)
      const page = parseOlderPageResponse(data)

      if (!res.ok || !page) {
        setErr(parseErrorMessage(data, 'Could not load earlier messages.'))
        return
      }

      setHasMoreOlder(page.hasMore)
      setOlderCursor(page.nextCursor)
      setErr(null)

      if (page.messages.length === 0) return

      setMessages((current) => {
        const localPending = current.filter((message) => message.status)
        const serverOnly = current.filter((message) => !message.status)
        return [...mergeServerMessages(serverOnly, page.messages), ...localPending]
      })

      // Restore the scroll offset after the prepended rows lay out, so the
      // message the user was reading stays put instead of jumping to the top.
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight - prevHeight + prevTop
      })
    } catch {
      setErr('Could not load earlier messages.')
    } finally {
      setLoadingOlder(false)
    }
  }, [hasMoreOlder, loadingOlder, olderCursor, threadId])

  // Post one message body under a stable clientId. Shows the bubble immediately
  // (status 'sending'); on success swaps in the server message, on failure marks
  // it 'failed' so the user can retry. Returns nothing — state carries the result.
  // POST a message (text and/or already-uploaded attachment paths) under a
  // stable clientId. Returns whether the send succeeded; state carries the
  // result (swap the optimistic row for the server message, or mark it failed).
  const postMessage = useCallback(
    async (
      bodyText: string,
      attachmentPaths: string[],
      clientId: string,
    ): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/v1/messages/threads/${encodeURIComponent(threadId)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: bodyText,
              ...(attachmentPaths.length
                ? { attachments: attachmentPaths }
                : {}),
            }),
          },
        )

        const data = await readJsonResponse(res)
        const sentMessage = parseSendMessageResponse(data)

        if (!res.ok || !sentMessage) {
          setErr(parseErrorMessage(data, 'Send failed.'))
          setMessages((current) =>
            current.map((message) =>
              message.clientId === clientId
                ? { ...message, status: 'failed' }
                : message,
            ),
          )
          return false
        }

        setErr(null)
        setMessages((current) => {
          // Replace the optimistic row with the server message; guard against a
          // poll that already inserted it by id.
          const withoutOptimistic = current.filter(
            (message) =>
              message.clientId !== clientId && message.id !== sentMessage.id,
          )
          return [...withoutOptimistic, sentMessage]
        })
        void markRead()
        return true
      } catch {
        setErr('Send failed.')
        setMessages((current) =>
          current.map((message) =>
            message.clientId === clientId
              ? { ...message, status: 'failed' }
              : message,
          ),
        )
        return false
      }
    },
    [markRead, threadId],
  )

  // Presign → signed PUT the image bytes to media-private; returns the storage
  // path to send with the message, or null on any failure.
  const uploadAttachment = useCallback(
    async (file: File): Promise<string | null> => {
      const contentType = file.type || 'image/jpeg'
      try {
        const res = await fetch(
          `/api/v1/messages/threads/${encodeURIComponent(threadId)}/uploads`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contentType, size: file.size }),
          },
        )
        const data = await readJsonResponse(res)
        if (!res.ok || !isRecord(data)) return null

        const bucket = data.bucket
        const path = data.path
        const token = data.token
        if (
          typeof bucket !== 'string' ||
          typeof path !== 'string' ||
          typeof token !== 'string'
        ) {
          return null
        }

        const controller = new AbortController()
        const { error } = await uploadWithProgress({
          bucket,
          path,
          token,
          file,
          contentType,
          onProgress: () => {},
          signal: controller.signal,
        })
        return error ? null : path
      } catch {
        return null
      }
    },
    [threadId],
  )

  const send = useCallback(async () => {
    const image = pendingImage
    if ((!trimmedText && !image) || sending) return

    const clientId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c_${Date.now()}_${Math.round(Math.random() * 1e9)}`
    const body = trimmedText
    const optimistic: Msg = {
      id: clientId,
      clientId,
      body: body || null,
      createdAt: new Date().toISOString(),
      senderUserId: myUserId,
      attachments: image
        ? [{ id: `${clientId}-att`, url: image.previewUrl, mediaType: 'IMAGE' }]
        : [],
      status: 'sending',
    }

    setSending(true)
    setErr(null)
    setText('')
    setPendingImage(null)
    setMessages((current) => [...current, optimistic])
    queueMicrotask(() => scrollToBottom('auto'))

    try {
      let attachmentPaths: string[] = []
      if (image) {
        const path = await uploadAttachment(image.file)
        if (!path) {
          // Upload failed before the message was created — drop the optimistic
          // row and restore the composer so the user can retry the whole send.
          setMessages((current) =>
            current.filter((m) => m.clientId !== clientId),
          )
          setText(body)
          setPendingImage(image)
          setErr('Could not upload image.')
          return
        }
        attachmentPaths = [path]
        // Stash the uploaded path so a POST failure retries without re-uploading.
        setMessages((current) =>
          current.map((m) =>
            m.clientId === clientId
              ? { ...m, retryAttachmentPaths: attachmentPaths }
              : m,
          ),
        )
      }

      const ok = await postMessage(body, attachmentPaths, clientId)
      if (ok && image) URL.revokeObjectURL(image.previewUrl)
    } finally {
      setSending(false)
    }
  }, [
    myUserId,
    pendingImage,
    postMessage,
    scrollToBottom,
    sending,
    trimmedText,
    uploadAttachment,
  ])

  const retry = useCallback(
    async (message: Msg) => {
      const clientId = message.clientId
      const paths = message.retryAttachmentPaths ?? []
      if (!clientId) return
      if (!message.body && paths.length === 0) return

      setMessages((current) =>
        current.map((m) =>
          m.clientId === clientId ? { ...m, status: 'sending' } : m,
        ),
      )
      await postMessage(message.body ?? '', paths, clientId)
    },
    [postMessage],
  )

  // Stage a picked image into the composer (revoking any prior preview).
  const onPickImage = useCallback(
    (file: File | null) => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        setErr('Only images can be attached.')
        return
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        setErr(`Image too large (max ${UPLOAD_MAX_LABEL}).`)
        return
      }
      setErr(null)
      setPendingImage((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl)
        return { file, previewUrl: URL.createObjectURL(file) }
      })
    },
    [],
  )

  const clearPendingImage = useCallback(() => {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
  }, [])

  useEffect(() => {
    cancelledRef.current = false

    queueMicrotask(() => scrollToBottom('auto'))
    void markRead()

    const onFocus = () => {
      void markRead()
      void fetchLatest()
    }

    window.addEventListener('focus', onFocus)

    return () => {
      cancelledRef.current = true
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchLatest, markRead, scrollToBottom, threadId])

  useEffect(() => {
    let intervalId: number | null = null

    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void fetchLatest()
    }

    const start = () => {
      if (intervalId !== null) return
      intervalId = window.setInterval(tick, 10000)
    }

    const stop = () => {
      if (intervalId === null) return
      window.clearInterval(intervalId)
      intervalId = null
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchLatest()
        start()
        return
      }

      stop()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    onVisibilityChange()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchLatest, lastId])

  // Live-sync (Layer 2): a "changed" ping on my channel means the counterparty
  // just sent — refetch right away so new messages land without waiting on the
  // 10s poll. The poll/focus refresh stay as a fail-open safety net.
  useLiveChannels(liveChannel ? [liveChannel] : [], () => {
    void fetchLatest()
  })

  // The last of my confirmed messages the counterparty has read — the only one
  // that shows a "Read" receipt (iMessage-style).
  const lastReadMineId = useMemo(() => {
    if (!counterpartyLastReadAt) return null
    const readTs = new Date(counterpartyLastReadAt).getTime()
    if (Number.isNaN(readTs)) return null

    let id: string | null = null
    for (const message of messages) {
      if (message.senderUserId !== myUserId || message.status) continue
      if (new Date(message.createdAt).getTime() <= readTs) id = message.id
    }
    return id
  }, [counterpartyLastReadAt, messages, myUserId])

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      {err ? (
        <div className="mb-3 rounded-[18px] border border-ember/30 bg-bgSecondary/70 px-4 py-3 text-[12px] font-medium text-textSecondary">
          {err}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-textPrimary/10 bg-bgSecondary/30">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-textMuted">
              No messages yet — start it off.
            </div>
          ) : (
            <div className="grid gap-[14px]">
              {hasMoreOlder ? (
                <div className="flex justify-center pb-1">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="rounded-full border border-textPrimary/10 bg-bgPrimary/70 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-textSecondary transition hover:text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              ) : null}

              {messages.map((message, index) => {
                const mine = message.senderUserId === myUserId
                const showDaySeparator =
                  index === 0 ||
                  dayKey(messages[index - 1]!.createdAt) !==
                    dayKey(message.createdAt)

                return (
                  <div key={message.clientId ?? message.id} className="grid gap-[14px]">
                    {showDaySeparator ? (
                      <div className="flex items-center justify-center pt-1">
                        <span className="rounded-full bg-bgPrimary/70 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-textMuted">
                          {dayLabel(message.createdAt)}
                        </span>
                      </div>
                    ) : null}

                    <div
                      className={classNames([
                        'flex',
                        mine ? 'justify-end' : 'justify-start',
                      ])}
                    >
                      <div className="max-w-[80%]">
                        <div
                          className={classNames([
                            'px-[14px] py-[11px] text-[13.5px] font-medium leading-[1.45]',
                            mine
                              ? 'rounded-[16px] rounded-br-[5px] bg-accentPrimary text-onAccent'
                              : 'rounded-[16px] rounded-bl-[5px] border border-textPrimary/10 bg-bgPrimary/45 text-textPrimary',
                            message.status === 'sending' && 'opacity-60',
                            message.status === 'failed' &&
                              'ring-1 ring-ember/50',
                          ])}
                        >
                          {message.body ? (
                            <div className="whitespace-pre-wrap break-words">
                              {message.body}
                            </div>
                          ) : null}

                          {message.attachments.length > 0 ? (
                            <div className="mt-2 grid gap-2">
                              {message.attachments.map((attachment) => (
                                <AttachmentPreview
                                  key={attachment.id}
                                  attachment={attachment}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div
                          className={classNames([
                            'mt-[5px] flex items-center gap-1.5 px-1 font-mono text-[9px] text-textMuted',
                            mine ? 'justify-end' : 'justify-start',
                          ])}
                        >
                          <span>{formatTime(message.createdAt)}</span>
                          {mine && message.status === 'sending' ? (
                            <span>· Sending…</span>
                          ) : mine && message.status === 'failed' ? (
                            <button
                              type="button"
                              onClick={() => void retry(message)}
                              className="font-semibold text-ember hover:opacity-80"
                            >
                              · Failed · Retry
                            </button>
                          ) : mine && message.id === lastReadMineId ? (
                            <span className="text-accentPrimary">· Read</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-textPrimary/10 p-3">
          {pendingImage ? (
            <div className="mb-2 flex items-center gap-2">
              <div className="relative">
                <RemoteImage
                  src={pendingImage.previewUrl}
                  alt="Attachment preview"
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-[10px] border border-textPrimary/10 object-cover"
                />
                <button
                  type="button"
                  onClick={clearPendingImage}
                  aria-label="Remove image"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bgPrimary text-[11px] font-bold leading-none text-textSecondary shadow ring-1 ring-textPrimary/10 hover:text-textPrimary"
                >
                  ×
                </button>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-textMuted">
                Image ready
              </span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              onPickImage(event.target.files?.[0] ?? null)
              // Reset so re-picking the same file still fires onChange.
              event.target.value = ''
            }}
          />

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach image"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-textPrimary/10 bg-bgPrimary text-textSecondary transition hover:text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <textarea
              value={text}
              rows={1}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              placeholder="Message…"
              className="max-h-28 min-h-11 w-full resize-none rounded-[999px] border border-textPrimary/10 bg-bgPrimary px-4 py-3 text-[13px] font-medium leading-5 text-textPrimary outline-none placeholder:text-textMuted focus:border-accentPrimary/40"
            />

            <button
              type="button"
              onClick={() => void send()}
              disabled={(!trimmedText && !pendingImage) || sending}
              className="h-11 shrink-0 rounded-full bg-accentPrimary px-5 text-[13px] font-bold text-onAccent transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.06em] text-textMuted">
            <span>{loading ? 'Updating…' : ' '}</span>

            <button
              type="button"
              onClick={() => void fetchLatest()}
              className="font-mono uppercase tracking-[0.06em] text-textSecondary hover:text-textPrimary"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}