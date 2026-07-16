// lib/support/createSupportTicket.ts
//
// The single writer for SupportTicket, shared by the web `/support` server
// action and the native `POST /api/v1/support/tickets` route so the two can't
// drift. The admin alert is the reason this is shared rather than copied: a
// ticket that never reaches `/admin/support` is invisible, and that failure mode
// is silent, so both entry points must fan it out identically.
//
// Attribution is the whole point of the native route. `SupportTicket` has no
// contact column — `createdByUserId` IS the reply path (`/admin/support/[id]`
// resolves the author from it), so a ticket filed by a signed-in user is
// answerable and an anonymous one is not. Native auth is bearer-token and
// cookieless by design, so the web page can never see an iOS caller; only an
// authenticated API route can attribute those tickets.
import { emitAdminSupportTicketCreated } from '@/lib/notifications/adminNotifications'
import { prisma } from '@/lib/prisma'

import type { Role, SupportTicket } from '@prisma/client'

// Backstops, not UX: the columns are unbounded Postgres text. The web form
// mirrors these as `maxLength` attrs so a browser never trips them; they exist
// so an API caller can't post a novel that breaks the admin queue's rendering.
export const SUPPORT_SUBJECT_MAX_LEN = 200
export const SUPPORT_MESSAGE_MAX_LEN = 5000

/**
 * The signed-in author, or `null` for an anonymous web visitor. Only the web
 * form can produce `null` — the native route is bearer-authenticated.
 */
export type SupportTicketAuthor = { id: string; role: Role } | null

export type CreateSupportTicketError = {
  /** Stable machine-readable code — rides in the API failure body. */
  code: 'MISSING_FIELDS' | 'SUBJECT_TOO_LONG' | 'MESSAGE_TOO_LONG'
  message: string
}

export type CreatedSupportTicket = Pick<
  SupportTicket,
  'id' | 'subject' | 'status' | 'createdAt'
>

export type CreateSupportTicketResult =
  | { ok: true; ticket: CreatedSupportTicket }
  | { ok: false; error: CreateSupportTicketError }

/**
 * Stored as a plain string (the column avoids enum coupling). An unauthenticated
 * visitor is a GUEST; everyone else is tagged with their acting role, so a pro
 * writing in from a client workspace is filed the way they were acting.
 */
function resolveCreatedByRole(author: SupportTicketAuthor): string {
  return author?.role ?? 'GUEST'
}

export async function createSupportTicket(args: {
  author: SupportTicketAuthor
  subject: string
  message: string
}): Promise<CreateSupportTicketResult> {
  const subject = args.subject.trim()
  const message = args.message.trim()

  if (!subject || !message) {
    return {
      ok: false,
      error: { code: 'MISSING_FIELDS', message: 'Subject and message are required.' },
    }
  }

  if (subject.length > SUPPORT_SUBJECT_MAX_LEN) {
    return {
      ok: false,
      error: {
        code: 'SUBJECT_TOO_LONG',
        message: `Subject must be ${SUPPORT_SUBJECT_MAX_LEN} characters or fewer.`,
      },
    }
  }

  if (message.length > SUPPORT_MESSAGE_MAX_LEN) {
    return {
      ok: false,
      error: {
        code: 'MESSAGE_TOO_LONG',
        message: `Message must be ${SUPPORT_MESSAGE_MAX_LEN} characters or fewer.`,
      },
    }
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      createdByUserId: args.author?.id ?? null,
      createdByRole: resolveCreatedByRole(args.author),
      subject,
      message,
      status: 'OPEN',
    },
    select: { id: true, subject: true, status: true, createdAt: true },
  })

  // Best-effort: a dropped admin alert must never fail a submission the user
  // already got confirmation for — the ticket is durable either way.
  try {
    await emitAdminSupportTicketCreated({ ticketId: ticket.id, subject })
  } catch (notifyError) {
    console.error('support ticket admin notify error', notifyError)
  }

  return { ok: true, ticket }
}
