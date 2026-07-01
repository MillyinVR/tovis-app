// POST   /api/v1/pro/finance/receipts/[id]/confirm — turn a pending receipt into
//        a real expense (and mark the inbox item CONFIRMED).
// DELETE /api/v1/pro/finance/receipts/[id] — dismiss a pending receipt.
// Both strictly scoped to the pro's own inbox items.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  expenseDateFields,
  serializeProFinanceExpense,
} from '@/lib/finance/proFinanceSummary'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/time'

import {
  EXPENSE_SELECT,
  parseExpenseWriteInput,
  resolveExpenseAmount,
} from '../../expenses/expenseInput'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST .../[id]/confirm is expressed as POST .../[id] with the confirm body — the
// route file lives at [id]; the trailing segment is handled by the client path.
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const receiptId = pickString(rawId)
    if (!receiptId) return jsonFail(400, 'Missing id.')

    const limited = await enforceRateLimit({
      bucket: 'pro:finance:expenses:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const raw: unknown = await request.json().catch(() => null)
    const parsed = parseExpenseWriteInput(raw, { requireAll: true })
    if (!parsed.ok) return jsonFail(400, parsed.error)

    const { category, amountCents, miles, label, dateInput } = parsed.value
    if (category === undefined || label === undefined || dateInput === undefined) {
      return jsonFail(400, 'Missing required expense fields.')
    }

    const item = await prisma.professionalReceiptInbox.findFirst({
      where: {
        id: receiptId,
        professionalId: auth.professionalId,
        status: 'PENDING',
      },
      select: { id: true, receiptMediaId: true },
    })
    if (!item) return jsonFail(404, 'Receipt not found.')

    const money = resolveExpenseAmount({ category, amountCents, miles })
    if (!money.ok) return jsonFail(400, money.error)

    const timeZone = sanitizeTimeZone(
      auth.user.professionalProfile?.timeZone,
      DEFAULT_TIME_ZONE,
    )
    const { spentAt, monthKey } = expenseDateFields({ dateInput, timeZone })

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.professionalExpense.create({
        data: {
          professionalId: auth.professionalId,
          category,
          source: item.receiptMediaId ? 'RECEIPT_UPLOAD' : 'MANUAL',
          amountCents: money.amountCents,
          mileageMiles: money.mileageMiles,
          label,
          notes: null,
          spentAt,
          monthKey,
          receiptMediaId: item.receiptMediaId,
        },
        select: EXPENSE_SELECT,
      })

      await tx.professionalReceiptInbox.update({
        where: { id: item.id },
        data: { status: 'CONFIRMED', createdExpenseId: created.id },
      })

      return created
    })

    return jsonOk(serializeProFinanceExpense(expense, timeZone), 201)
  } catch (error) {
    console.error('POST /api/v1/pro/finance/receipts/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const receiptId = pickString(rawId)
    if (!receiptId) return jsonFail(400, 'Missing id.')

    const result = await prisma.professionalReceiptInbox.updateMany({
      where: {
        id: receiptId,
        professionalId: auth.professionalId,
        status: 'PENDING',
      },
      data: { status: 'DISMISSED' },
    })
    if (result.count === 0) return jsonFail(404, 'Receipt not found.')

    return jsonOk({ ok: true })
  } catch (error) {
    console.error('DELETE /api/v1/pro/finance/receipts/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}
