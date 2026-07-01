// POST /api/v1/pro/finance/expenses — create a manually-tracked expense on the
// pro Finance tab. Income is derived from bookings; expenses are the one thing
// the pro enters. Returns the created row in the same shape the Finance page
// renders it.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import {
  expenseDateFields,
  serializeProFinanceExpense,
} from '@/lib/finance/proFinanceSummary'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/time'

import {
  parseExpenseWriteInput,
  receiptBelongsToPro,
} from './expenseInput'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
    const parsed = parseExpenseWriteInput(raw, { requireAll: true })
    if (!parsed.ok) return jsonFail(400, parsed.error)

    const {
      category,
      amountCents,
      label,
      dateInput,
      notes,
      receiptMediaId,
    } = parsed.value

    // requireAll guarantees these are present, but narrow for the type checker.
    if (
      category === undefined ||
      amountCents === undefined ||
      label === undefined ||
      dateInput === undefined
    ) {
      return jsonFail(400, 'Missing required expense fields.')
    }

    if (receiptMediaId) {
      const owns = await receiptBelongsToPro({
        receiptMediaId,
        professionalId: auth.professionalId,
      })
      if (!owns) return jsonFail(400, 'Receipt not found.')
    }

    const timeZone = sanitizeTimeZone(
      auth.user.professionalProfile?.timeZone,
      DEFAULT_TIME_ZONE,
    )

    const { spentAt, monthKey } = expenseDateFields({ dateInput, timeZone })

    const created = await prisma.professionalExpense.create({
      data: {
        professionalId: auth.professionalId,
        category,
        source: receiptMediaId ? 'RECEIPT_UPLOAD' : 'MANUAL',
        amountCents,
        label,
        notes: notes ?? null,
        spentAt,
        monthKey,
        receiptMediaId: receiptMediaId ?? null,
      },
      select: {
        id: true,
        category: true,
        source: true,
        amountCents: true,
        label: true,
        notes: true,
        spentAt: true,
        receiptMediaId: true,
      },
    })

    return jsonOk(serializeProFinanceExpense(created, timeZone), 201)
  } catch (error) {
    console.error('POST /api/v1/pro/finance/expenses error', error)
    return jsonFail(500, 'Internal server error')
  }
}
