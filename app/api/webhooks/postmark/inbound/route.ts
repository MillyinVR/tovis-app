// POST /api/webhooks/postmark/inbound — Postmark Inbound stream webhook.
//
// A pro forwards (or auto-sends from CosmoProf / Salon Centric settings) a
// receipt to <handle>@tovis.me. Postmark receives it and POSTs the parsed
// message here; we resolve the pro from the address's handle and drop a PENDING
// item into their receipt inbox (best-effort amount/vendor parse — the pro
// confirms it into an expense). Parsing is intentionally forgiving; we never
// bounce (always 200 to Postmark) so a bad parse just needs manual review.
//
// ⚠️ Dormant until infra is wired (operator): MX for the inbox domain → Postmark,
// a Postmark Inbound stream pointing at this URL with Basic auth, and the
// POSTMARK_WEBHOOK_USERNAME/PASSWORD env. Attachment storage is a follow-up.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  detectReceiptVendor,
  extractInboxHandle,
  parseReceiptAmountCents,
} from '@/lib/finance/receiptInbox'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { assertPostmarkWebhookAuth } from '@/lib/security/postmarkWebhookAuth'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function recipientCandidates(payload: Record<string, unknown>): string[] {
  const candidates: string[] = []
  const original = str(payload.OriginalRecipient)
  if (original) candidates.push(original)
  if (Array.isArray(payload.ToFull)) {
    for (const entry of payload.ToFull) {
      const email = isRecord(entry) ? str(entry.Email) : null
      if (email) candidates.push(email)
    }
  }
  const to = str(payload.To)
  if (to) candidates.push(to)
  return candidates
}

export async function POST(req: Request) {
  try {
    if (!assertPostmarkWebhookAuth(req)) return jsonFail(403, 'Forbidden.')

    const payload: unknown = await req.json().catch(() => null)
    if (!isRecord(payload)) return jsonFail(400, 'Invalid inbound payload.')

    const handle = extractInboxHandle(recipientCandidates(payload))
    if (!handle) return jsonOk({ received: true, matched: false })

    // The forwarding address is a premium perk tied to the claimed handle.
    const pro = await prisma.professionalProfile.findFirst({
      where: { handleNormalized: handle, isPremium: true },
      select: { id: true, timeZone: true },
    })
    if (!pro) return jsonOk({ received: true, matched: false })

    const subject = str(payload.Subject)
    const from = str(payload.From)
    const body =
      str(payload.TextBody) ?? str(payload.StrippedTextReply) ?? ''
    const { source, vendor } = detectReceiptVendor(`${from ?? ''} ${subject ?? ''}`)
    const parsedAmountCents = parseReceiptAmountCents(`${subject ?? ''} ${body}`)

    const dateRaw = str(payload.Date)
    const parsedDate = dateRaw ? new Date(dateRaw) : null
    const receivedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date()

    await prisma.professionalReceiptInbox.create({
      data: {
        professionalId: pro.id,
        source,
        status: 'PENDING',
        parsedAmountCents,
        parsedVendor: vendor,
        parsedDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
        emailFrom: from,
        emailSubject: subject,
        receivedAt,
      },
    })

    return jsonOk({ received: true, matched: true })
  } catch (error) {
    console.error('POST /api/webhooks/postmark/inbound error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Failed to process inbound receipt.')
  }
}
