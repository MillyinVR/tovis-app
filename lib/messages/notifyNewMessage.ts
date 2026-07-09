// lib/messages/notifyNewMessage.ts
//
// New-message notification (NotificationEventKey.MESSAGE_RECEIVED) → the OTHER
// participant(s) of a thread. In-app + PUSH (no email/SMS — the inbox is the
// durable record; a chat message isn't a receipt). Callers invoke this
// best-effort AFTER the send transaction commits, then kickNotificationDrain().
//
// Debounce: at most one dispatch (inbox row create + push) per thread per
// recipient per DEBOUNCE window. The window rides in the dedupeKey, so a rapid
// burst inside the window refreshes the existing row (bumps it unread, updates
// the preview) WITHOUT firing a second push — the create-notification helpers'
// dedupe contract only enqueues delivery for a newly-created row. A message in
// the next window is a fresh row → a fresh push, so an ongoing conversation
// keeps notifying without spamming a burst.

import { NotificationEventKey, Role } from '@prisma/client'

import { createClientNotification } from '@/lib/notifications/clientNotifications'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { prisma } from '@/lib/prisma'

import { resolveThreadCounterparty } from './counterparty'

/**
 * Debounce window. Two minutes coalesces a genuine rapid burst into one push
 * while still re-notifying a conversation that continues past it.
 */
export const MESSAGE_NOTIFICATION_DEBOUNCE_MS = 2 * 60 * 1000

/** Internal deep-link the notification (in-app + push) opens on tap. */
export function messageThreadHref(threadId: string): string {
  return `/messages/thread/${encodeURIComponent(threadId)}`
}

/**
 * `msg:<threadId>:<windowBucket>` — one row per thread per debounce window. The
 * recipient scoping is implicit: the create helpers key dedupe by
 * (clientId|professionalId, dedupeKey), so each recipient gets their own row.
 */
export function buildMessageNotificationDedupeKey(
  threadId: string,
  when: Date,
  windowMs: number = MESSAGE_NOTIFICATION_DEBOUNCE_MS,
): string {
  const bucket = Math.floor(when.getTime() / windowMs)
  return `msg:${threadId}:${bucket}`
}

export type NotifyNewMessageArgs = {
  threadId: string
  /** The user who just sent the message — never notified. */
  senderUserId: string
  /** Inbox preview for the message (text slice or an attachment label). */
  preview: string
  /** Injectable clock for tests; defaults to now. */
  now?: Date
}

const notifyThreadSelect = {
  id: true,
  clientId: true,
  professionalId: true,
  participants: { select: { userId: true, role: true } },
  client: {
    select: {
      firstName: true, // pii-plaintext-read-ok: counterparty name for notif title (same as inbox)
      lastName: true, // pii-plaintext-read-ok: counterparty name for notif title (same as inbox)
      avatarUrl: true,
    },
  },
  professional: {
    select: {
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: counterparty name for notif title (same as inbox)
      lastName: true, // pii-plaintext-read-ok: counterparty name for notif title (same as inbox)
      avatarUrl: true,
    },
  },
} as const

/**
 * Notify every participant who is NOT the sender that a new message arrived.
 * The sender's display name (from the recipient's perspective) is exactly the
 * recipient's counterparty, so `resolveThreadCounterparty` is reused for the
 * title. Best-effort: throws are the caller's to swallow.
 */
export async function notifyNewMessageRecipients(
  args: NotifyNewMessageArgs,
): Promise<void> {
  const now = args.now ?? new Date()

  const thread = await prisma.messageThread.findUnique({
    where: { id: args.threadId },
    select: notifyThreadSelect,
  })

  if (!thread) return

  const href = messageThreadHref(thread.id)
  const dedupeKey = buildMessageNotificationDedupeKey(thread.id, now)
  const preview = args.preview.trim() || 'Sent you a message'

  for (const participant of thread.participants) {
    if (participant.userId === args.senderUserId) continue

    const recipientIsPro = participant.role === Role.PRO
    const senderName = resolveThreadCounterparty({
      viewerIsThreadPro: recipientIsPro,
      client: thread.client,
      professional: thread.professional,
    }).title
    const title = `New message from ${senderName}`

    if (recipientIsPro) {
      await createProNotification({
        professionalId: thread.professionalId,
        eventKey: NotificationEventKey.MESSAGE_RECEIVED,
        title,
        body: preview,
        href,
        dedupeKey,
        actorUserId: args.senderUserId,
      })
    } else {
      await createClientNotification({
        clientId: thread.clientId,
        eventKey: NotificationEventKey.MESSAGE_RECEIVED,
        title,
        body: preview,
        href,
        dedupeKey,
      })
    }
  }
}
