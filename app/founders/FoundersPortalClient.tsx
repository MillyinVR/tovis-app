'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bug,
  CircleHelp,
  Heart,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { FounderMessageKind, FounderRoomKey } from '@prisma/client'

import type {
  FounderMessageDTO,
  FounderMessagesResponseDTO,
  FounderPortalDTO,
} from '@/lib/dto/founders'
import {
  DEFAULT_TIME_ZONE,
  formatRelativeTimeAgo,
  getViewerTimeZone,
} from '@/lib/time'

type MessagesEnvelope = FounderMessagesResponseDTO & { ok: true }
type CreateEnvelope = { ok: true; message: FounderMessageDTO }

const MESSAGE_KINDS: readonly {
  value: FounderMessageKind
  label: string
  icon: typeof MessageCircle
}[] = [
  { value: 'CHAT', label: 'Chat', icon: MessageCircle },
  { value: 'QUESTION', label: 'Question', icon: CircleHelp },
  { value: 'BUG', label: 'Bug', icon: Bug },
  { value: 'IDEA', label: 'Idea', icon: Lightbulb },
  { value: 'LOVE', label: 'Love', icon: Heart },
]

export default function FoundersPortalClient({
  initialPortal,
  currentUserId,
}: {
  initialPortal: FounderPortalDTO
  currentUserId: string
}) {
  const viewerTimeZone = getViewerTimeZone() ?? DEFAULT_TIME_ZONE
  const [selectedRoom, setSelectedRoom] = useState<FounderRoomKey>(
    initialPortal.rooms[0]?.key ?? 'PRO_ALL',
  )
  const [messages, setMessages] = useState<FounderMessageDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<FounderMessageKind>('CHAT')
  const [replyTo, setReplyTo] = useState<FounderMessageDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => new Set())

  const room = useMemo(
    () => initialPortal.rooms.find((candidate) => candidate.key === selectedRoom),
    [initialPortal.rooms, selectedRoom],
  )

  const loadMessages = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await fetch(
        `/api/v1/founders/rooms/${encodeURIComponent(selectedRoom)}/messages`,
        { credentials: 'include', cache: 'no-store' },
      )
      if (!response.ok) throw new Error('Could not load this room.')
      const payload: MessagesEnvelope = await response.json()
      setMessages(payload.messages)
      setError(null)
      void fetch(
        `/api/v1/founders/rooms/${encodeURIComponent(selectedRoom)}/read`,
        { method: 'POST', credentials: 'include' },
      )
    } catch (loadError: unknown) {
      if (!quiet) {
        setError(
          loadError instanceof Error ? loadError.message : 'Could not load this room.',
        )
      }
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [selectedRoom])

  useEffect(() => {
    void loadMessages()
    const timer = window.setInterval(() => void loadMessages(true), 15_000)
    return () => window.clearInterval(timer)
  }, [loadMessages])

  async function sendMessage() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/founders/rooms/${encodeURIComponent(selectedRoom)}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: text, kind, replyToId: replyTo?.id ?? null }),
        },
      )
      if (!response.ok) throw new Error('Your message could not be sent.')
      const payload: CreateEnvelope = await response.json()
      setMessages((current) => [...current, payload.message])
      setBody('')
      setKind('CHAT')
      setReplyTo(null)
    } catch (sendError: unknown) {
      setError(
        sendError instanceof Error ? sendError.message : 'Your message could not be sent.',
      )
    } finally {
      setSending(false)
    }
  }

  async function reportMessage(message: FounderMessageDTO) {
    if (reportedIds.has(message.id)) return
    if (!window.confirm('Send this message to the moderation team for review?')) return
    try {
      const response = await fetch(
        `/api/v1/founders/messages/${encodeURIComponent(message.id)}/report`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'OTHER' }),
        },
      )
      if (!response.ok) throw new Error('Could not report this message.')
      setReportedIds((current) => new Set(current).add(message.id))
    } catch (reportError: unknown) {
      setError(
        reportError instanceof Error
          ? reportError.message
          : 'Could not report this message.',
      )
    }
  }

  return (
    <main className="founders-shell">
      <aside className="founders-sidebar">
        <div className="founders-brand">
          <span className="founders-mark"><Users size={18} /></span>
          <span><strong>Founders Portal</strong><small>Build the future together</small></span>
        </div>

        <nav aria-label="Founder rooms" className="founders-room-list">
          {initialPortal.rooms.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === selectedRoom ? 'founders-room active' : 'founders-room'}
              onClick={() => setSelectedRoom(item.key)}
            >
              <span>{item.audience === 'PRO' ? '✦' : '♡'}</span>
              <span className="founders-room-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              {item.unreadCount > 0 ? <b>{item.unreadCount}</b> : null}
            </button>
          ))}
        </nav>

        {initialPortal.canAdminister ? (
          <Link href="/founders/admin" className="founders-admin-link">
            <ShieldCheck size={17} /> Admin & membership
          </Link>
        ) : null}
      </aside>

      <section className="founders-conversation">
        <header className="founders-header">
          <div><small>FOUNDING CIRCLE</small><h1>{room?.label ?? 'Founders Portal'}</h1><p>{room?.description}</p></div>
          <span>{messages.length} recent</span>
        </header>

        <div className="founders-messages" aria-live="polite">
          {loading ? <p className="founders-state">Opening the conversation…</p> : null}
          {!loading && messages.length === 0 ? (
            <div className="founders-empty"><Users size={30} /><h2>Start this founding conversation</h2><p>Share what is working, what feels confusing, and what would make the product indispensable.</p></div>
          ) : null}
          {messages.map((message) => {
            const mine = message.author.id === currentUserId
            return (
              <article key={message.id} className={mine ? 'founders-message mine' : 'founders-message'}>
                <div className="founders-avatar">{message.author.displayName.charAt(0).toUpperCase()}</div>
                <div><div className="founders-message-meta"><strong>{message.author.displayName}</strong><span className={`founders-kind kind-${message.kind.toLowerCase()}`}>{message.kind.toLowerCase()}</span><time>{formatRelativeTimeAgo(message.createdAt, viewerTimeZone)}</time></div><p>{message.body}</p><div className="founders-message-actions">{message.answeredAt ? <small className="founders-answered">✓ Answered by the team</small> : null}<button type="button" onClick={() => setReplyTo(message)}>{initialPortal.canModerate && message.kind === 'QUESTION' ? 'Answer' : 'Reply'}</button>{!mine && !initialPortal.canModerate ? <button type="button" onClick={() => void reportMessage(message)} disabled={reportedIds.has(message.id)}>{reportedIds.has(message.id) ? 'Reported' : 'Report'}</button> : null}</div></div>
              </article>
            )
          })}
        </div>

        <footer className="founders-compose">
          {error ? <p role="alert" className="founders-error">{error}</p> : null}
          {replyTo ? <div className="founders-replying"><span>Replying to <strong>{replyTo.author.displayName}</strong>: {replyTo.body.slice(0, 90)}</span><button type="button" onClick={() => setReplyTo(null)}>Cancel</button></div> : null}
          <div className="founders-kind-picker" aria-label="Message type">
            {MESSAGE_KINDS.map((option) => {
              const Icon = option.icon
              return <button key={option.value} type="button" className={kind === option.value ? 'active' : ''} onClick={() => setKind(option.value)}><Icon size={14} />{option.label}</button>
            })}
            {initialPortal.canAdminister ? <button type="button" className={kind === 'ANNOUNCEMENT' ? 'active' : ''} onClick={() => setKind('ANNOUNCEMENT')}><Megaphone size={14} />Announcement</button> : null}
          </div>
          <div className="founders-compose-row">
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} placeholder="Share feedback, ask a question, or tell us what would make this better…" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} />
            <button type="button" onClick={() => void sendMessage()} disabled={!body.trim() || sending} aria-label="Send message"><Send size={18} /></button>
          </div>
        </footer>
      </section>
    </main>
  )
}
