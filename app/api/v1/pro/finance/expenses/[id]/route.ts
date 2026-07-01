// PATCH  /api/v1/pro/finance/expenses/[id] — edit a tracked expense.
// DELETE /api/v1/pro/finance/expenses/[id] — remove a tracked expense.
// Both are strictly scoped to the authenticated pro's own rows.
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
  receiptBelongsToPro,
  resolveExpenseAmount,
  type ExpenseWriteFields,
} from '../expenseInput'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ResolvedMoney = { amountCents: number; mileageMiles: number | null }

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const expenseId = pickString(rawId)
    if (!expenseId) return jsonFail(400, 'Missing id.')

    const limited = await enforceRateLimit({
      bucket: 'pro:finance:expenses:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const raw: unknown = await request.json().catch(() => null)
    const parsed = parseExpenseWriteInput(raw, { requireAll: false })
    if (!parsed.ok) return jsonFail(400, parsed.error)

    const existing = await prisma.professionalExpense.findFirst({
      where: { id: expenseId, professionalId: auth.professionalId },
      select: { id: true, category: true },
    })
    if (!existing) return jsonFail(404, 'Expense not found.')

    const fields = parsed.value

    if (fields.receiptMediaId) {
      const owns = await receiptBelongsToPro({
        receiptMediaId: fields.receiptMediaId,
        professionalId: auth.professionalId,
      })
      if (!owns) return jsonFail(400, 'Receipt not found.')
    }

    // Recompute the stored amount/miles only when the caller changed either.
    let resolvedMoney: ResolvedMoney | null = null
    if (fields.amountCents !== undefined || fields.miles !== undefined) {
      const money = resolveExpenseAmount({
        category: fields.category ?? existing.category,
        amountCents: fields.amountCents,
        miles: fields.miles,
      })
      if (!money.ok) return jsonFail(400, money.error)
      resolvedMoney = {
        amountCents: money.amountCents,
        mileageMiles: money.mileageMiles,
      }
    }

    const timeZone = sanitizeTimeZone(
      auth.user.professionalProfile?.timeZone,
      DEFAULT_TIME_ZONE,
    )

    const data = buildUpdateData(fields, timeZone, resolvedMoney)

    const updated = await prisma.professionalExpense.update({
      where: { id: expenseId },
      data,
      select: EXPENSE_SELECT,
    })

    return jsonOk(serializeProFinanceExpense(updated, timeZone))
  } catch (error) {
    console.error('PATCH /api/v1/pro/finance/expenses/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const expenseId = pickString(rawId)
    if (!expenseId) return jsonFail(400, 'Missing id.')

    // deleteMany scoped by professionalId enforces ownership without a prior
    // read; count === 0 means "not yours / not found" → uniform 404.
    const result = await prisma.professionalExpense.deleteMany({
      where: { id: expenseId, professionalId: auth.professionalId },
    })

    if (result.count === 0) return jsonFail(404, 'Expense not found.')

    return jsonOk({ ok: true })
  } catch (error) {
    console.error('DELETE /api/v1/pro/finance/expenses/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}

function buildUpdateData(
  fields: ExpenseWriteFields,
  timeZone: string,
  money: ResolvedMoney | null,
) {
  const data: {
    category?: ExpenseWriteFields['category']
    amountCents?: number
    mileageMiles?: number | null
    label?: string
    notes?: string | null
    receiptMediaId?: string | null
    source?: 'RECEIPT_UPLOAD' | 'MANUAL'
    spentAt?: Date
    monthKey?: string
  } = {}

  if (fields.category !== undefined) data.category = fields.category
  if (money) {
    data.amountCents = money.amountCents
    data.mileageMiles = money.mileageMiles
  }
  if (fields.label !== undefined) data.label = fields.label
  if (fields.notes !== undefined) data.notes = fields.notes

  if (fields.dateInput !== undefined) {
    const { spentAt, monthKey } = expenseDateFields({
      dateInput: fields.dateInput,
      timeZone,
    })
    data.spentAt = spentAt
    data.monthKey = monthKey
  }

  // Only touch receipt/source when the caller explicitly sent receiptMediaId
  // (present in the parsed fields), so an unrelated edit never clears a receipt.
  if (fields.receiptMediaId !== undefined) {
    data.receiptMediaId = fields.receiptMediaId
    data.source = fields.receiptMediaId ? 'RECEIPT_UPLOAD' : 'MANUAL'
  }

  return data
}
