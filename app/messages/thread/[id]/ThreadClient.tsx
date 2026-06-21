// app/messages/thread/[id]/ThreadClient.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
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
}

type ThreadClientProps = {
  threadId: string
  myUserId: string
  initialMessages: Msg[]
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

function parseFetchMessagesResponse(value: unknown): Msg[] | null {
  if (!isRecord(value)) return null
  if (value.ok !== true) return null

  return parseMessages(value.messages)
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

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
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
  const { threadId, myUserId, initialMessages } = props

  const [messages, setMessages] = useState<Msg[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement | null>(null)
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
      await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/read`, {
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
        `/api/messages/threads/${encodeURIComponent(threadId)}`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      )

      const data = await readJsonResponse(res)
      const nextMessages = parseFetchMessagesResponse(data)

      if (!res.ok || !nextMessages) {
        setErr(parseErrorMessage(data, 'Could not refresh messages.'))
        return
      }

      setMessages((current) => {
        if (messageListsHaveSameTail(current, nextMessages)) {
          return current
        }

        queueMicrotask(() => scrollToBottom('auto'))
        return nextMessages
      })

      void markRead()
      setErr(null)
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [markRead, scrollToBottom, threadId])

  const send = useCallback(async () => {
    if (!trimmedText || sending) return

    setSending(true)
    setErr(null)

    try {
      const res = await fetch(
        `/api/messages/threads/${encodeURIComponent(threadId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmedText }),
        },
      )

      const data = await readJsonResponse(res)
      const sentMessage = parseSendMessageResponse(data)

      if (!res.ok || !sentMessage) {
        setErr(parseErrorMessage(data, 'Send failed.'))
        return
      }

      setText('')
      setMessages((current) => {
        const alreadyExists = current.some((message) => message.id === sentMessage.id)

        if (alreadyExists) {
          return current
        }

        return [...current, sentMessage]
      })

      queueMicrotask(() => scrollToBottom('auto'))
      void markRead()
    } finally {
      setSending(false)
    }
  }, [markRead, scrollToBottom, sending, threadId, trimmedText])

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

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      {err ? (
        <div className="mb-3 rounded-[18px] border border-ember/30 bg-bgSecondary/70 px-4 py-3 text-[12px] font-medium text-textSecondary">
          {err}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-textPrimary/10 bg-bgSecondary/30">
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-textMuted">
              No messages yet — start it off.
            </div>
          ) : (
            <div className="grid gap-[14px]">
              {messages.map((message) => {
                const mine = message.senderUserId === myUserId

                return (
                  <div
                    key={message.id}
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
                          'mt-[5px] px-1 font-mono text-[9px] text-textMuted',
                          mine ? 'text-right' : 'text-left',
                        ])}
                      >
                        {formatTime(message.createdAt)}
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
          <div className="flex items-end gap-2">
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
              disabled={!trimmedText || sending}
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