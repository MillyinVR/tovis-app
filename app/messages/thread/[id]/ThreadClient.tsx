// app/messages/thread/[id]/ThreadClient.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Attachment = { id: string; url: string; mediaType: 'IMAGE' | 'VIDEO' }
type Msg = {
  id: string
  body: string | null
  createdAt: string | Date
  senderUserId: string
  attachments?: Attachment[]
}

function fmtTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
}

export default function ThreadClient(props: { threadId: string; myUserId: string; initialMessages: Msg[] }) {
  const { threadId, myUserId } = props

  const [messages, setMessages] = useState<Msg[]>(props.initialMessages || [])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)

  const lastId = useMemo(() => messages[messages.length - 1]?.id ?? null, [messages])
  const bottomRef = useRef<HTMLDivElement | null>(null)

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }

  async function markRead() {
    try {
      await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      // ignore
    }
  }

  async function fetchLatest() {
    setLoading(true)
    try {
      const res = await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}`, {
        method: 'GET',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) return

      const next: Msg[] = (data.messages || []) as Msg[]
      const nextLast = next[next.length - 1]?.id ?? null

      // Only update if something actually changed
      if (nextLast && nextLast !== lastId) {
        setMessages(next)
        queueMicrotask(() => scrollToBottom('auto'))
        markRead()
      }
    } finally {
      setLoading(false)
    }
  }

  async function send() {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      const res = await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) return

      // optimistic-ish append (server returns message)
      const msg = data.message as Msg
      setText('')
      setMessages((prev) => [...prev, msg])
      queueMicrotask(() => scrollToBottom('auto'))
      markRead()
    } finally {
      setSending(false)
    }
  }

  // mark read on mount + focus
  useEffect(() => {
    markRead()
    // jump to bottom on first render
    queueMicrotask(() => scrollToBottom('auto'))

    const onFocus = () => markRead()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

// polling (every 4s)
useEffect(() => {
  const t = window.setInterval(() => {
    fetchLatest()
  }, 4000)

  return () => window.clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [threadId])

  return (
    <div className="mt-4">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary">
        <div className="max-h-[60vh] overflow-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="py-8 text-center text-[12px] font-semibold text-textSecondary">
              No messages yet. Start it off.
            </div>
          ) : (
            <div className="grid gap-2">
              {messages.map((m) => {
                const mine = m.senderUserId === myUserId
                const created = new Date(m.createdAt)
                const bubble = mine
                  ? 'bg-accentPrimary text-bgPrimary'
                  : 'bg-bgPrimary/35 text-textPrimary border border-white/10'
                const align = mine ? 'justify-end' : 'justify-start'

                return (
                  <div key={m.id} className={`flex ${align}`}>
                    <div className="max-w-[85%]">
                      <div className={`rounded-card px-4 py-2 text-[13px] font-semibold ${bubble}`}>
                        {m.body || ''}
                      </div>
                      <div className={`mt-1 text-[10px] font-semibold text-textSecondary ${mine ? 'text-right' : ''}`}>
                        {fmtTime(created)}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Message…"
              className="h-11 w-full rounded-full border border-white/10 bg-bgPrimary px-4 text-[13px] font-semibold text-textPrimary outline-none placeholder:text-textSecondary focus:border-white/20"
            />
            <button
              onClick={send}
              disabled={!text.trim() || sending}
              className="h-11 shrink-0 rounded-full bg-accentPrimary px-5 text-[13px] font-black text-bgPrimary disabled:opacity-50"
            >
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-textSecondary">
            <span>{loading ? 'Updating…' : ' '}</span>
            <button
              onClick={() => fetchLatest()}
              className="font-black text-textPrimary hover:opacity-80"
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
