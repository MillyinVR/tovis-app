// POST /api/v1/pro/finance/receipts — add a manually-captured receipt (a photo
// or PDF already uploaded via the media pipeline) to the pro's review inbox. It
// stays PENDING until the pro confirms it into an expense. Email-forwarded
// receipts land in the same inbox via the Postmark inbound webhook.
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { serializeReceiptInboxItem } from '@/lib/finance/receiptInbox'
import { isRecord } from '@/lib/guards'
import { moneyToCentsInt } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/time'

import { receiptBelongsToPro } from '../expenses/expenseInput'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RECEIPT_INBOX_SELECT = {
  id: true,
  source: true,
  parsedAmountCents: true,
  parsedVendor: true,
  parsedDate: true,
  emailFrom: true,
  emailSubject: true,
  receivedAt: true,
  receiptMediaId: true,
} as const

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const limited = await enforceRateLimit({
      bucket: 'pro:finance:expenses:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const raw: unknown = await request.json().catch(() => null)
    if (!isRecord(raw)) return jsonFail(400, 'Invalid JSON body.')

    const receiptMediaId = pickString(raw.receiptMediaId)?.trim() || null
    const vendor = pickString(raw.vendor)?.trim() || null

    // A receipt with neither an image nor a typed amount is nothing to review.
    let parsedAmountCents: number | null = null
    if (raw.amount !== undefined) {
      const value =
        typeof raw.amount === 'number'
          ? raw.amount.toFixed(2)
          : pickString(raw.amount)?.trim()
      const cents = value ? moneyToCentsInt(value) : null
      if (cents !== null && cents > 0) parsedAmountCents = cents
    }

    if (!receiptMediaId && parsedAmountCents === null) {
      return jsonFail(400, 'Attach a receipt image or enter an amount.')
    }

    if (receiptMediaId) {
      const owns = await receiptBelongsToPro({
        receiptMediaId,
        professionalId: auth.professionalId,
      })
      if (!owns) return jsonFail(400, 'Receipt not found.')
    }

    const created = await prisma.professionalReceiptInbox.create({
      data: {
        professionalId: auth.professionalId,
        source: 'UPLOAD',
        status: 'PENDING',
        receiptMediaId,
        parsedAmountCents,
        parsedVendor: vendor,
      },
      select: RECEIPT_INBOX_SELECT,
    })

    const timeZone = sanitizeTimeZone(
      auth.user.professionalProfile?.timeZone,
      DEFAULT_TIME_ZONE,
    )

    return jsonOk(serializeReceiptInboxItem(created, timeZone), 201)
  } catch (error) {
    console.error('POST /api/v1/pro/finance/receipts error', error)
    return jsonFail(500, 'Internal server error')
  }
}
