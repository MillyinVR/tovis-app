// Shared request-body parsing for the Finance expense write routes (POST create
// / PATCH update). Kept out of the summary module — this is API-layer input
// validation, not view-model logic.
import { ExpenseCategory, Prisma } from '@prisma/client'

import { pickString } from '@/app/api/_utils'
import { computeMileageDeductionCents } from '@/lib/finance/taxRates'
import { isRecord } from '@/lib/guards'
import { moneyToCentsInt } from '@/lib/money'
import { prisma } from '@/lib/prisma'

const MAX_LABEL_LEN = 200
const MAX_NOTES_LEN = 1000
// $1,000,000 ceiling — a sanity bound, not a business rule.
const MAX_AMOUNT_CENTS = 100_000_000
// A single trip's business miles — generous upper bound.
const MAX_MILES = 100_000

// The columns every expense write route reads back to serialize the row.
export const EXPENSE_SELECT = {
  id: true,
  category: true,
  source: true,
  amountCents: true,
  mileageMiles: true,
  label: true,
  notes: true,
  spentAt: true,
  receiptMediaId: true,
} satisfies Prisma.ProfessionalExpenseSelect

export type ExpenseDateInput = { year: number; month: number; day: number }

export type ExpenseWriteFields = {
  category?: ExpenseCategory
  amountCents?: number
  miles?: number
  label?: string
  dateInput?: ExpenseDateInput
  notes?: string | null
  receiptMediaId?: string | null
}

export type ParseResult =
  | { ok: true; value: ExpenseWriteFields }
  | { ok: false; error: string }

function isExpenseCategory(value: string): value is ExpenseCategory {
  return (Object.values(ExpenseCategory) as string[]).includes(value)
}

function parseMiles(raw: unknown): number | null {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : NaN
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MILES) return null
  // One decimal place, matching the Decimal(9,1) column.
  return Math.round(n * 10) / 10
}

function parseAmountCents(raw: unknown): number | null {
  const asString =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw.toFixed(2)
      : typeof raw === 'string'
        ? raw.trim()
        : null

  if (!asString) return null

  const cents = moneyToCentsInt(asString)
  if (cents === null) return null

  return cents
}

function parseDateInput(raw: unknown): ExpenseDateInput | null {
  if (typeof raw !== 'string') return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (year < 2000 || year > 2100) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  // Reject impossible days (e.g. Feb 30) by round-tripping through UTC.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

export function parseExpenseWriteInput(
  raw: unknown,
  opts: { requireAll: boolean },
): ParseResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Invalid JSON body.' }
  }

  const value: ExpenseWriteFields = {}

  // category
  if (raw.category !== undefined) {
    const category = pickString(raw.category)?.trim()
    if (!category || !isExpenseCategory(category)) {
      return { ok: false, error: 'Invalid expense category.' }
    }
    value.category = category
  } else if (opts.requireAll) {
    return { ok: false, error: 'Missing expense category.' }
  }

  // miles (mileage helper) — optional; drives the deduction for MILEAGE.
  if (raw.miles !== undefined) {
    const miles = parseMiles(raw.miles)
    if (miles === null) {
      return { ok: false, error: 'Invalid miles.' }
    }
    value.miles = miles
  }

  // amount — optional when miles is supplied (mileage computes the amount).
  if (raw.amount !== undefined || raw.amountCents !== undefined) {
    const cents = parseAmountCents(raw.amount ?? raw.amountCents)
    if (cents === null || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
      return { ok: false, error: 'Invalid amount.' }
    }
    value.amountCents = cents
  } else if (opts.requireAll && value.miles === undefined) {
    return { ok: false, error: 'Missing amount.' }
  }

  // label
  if (raw.label !== undefined) {
    const label = pickString(raw.label)?.trim()
    if (!label || label.length > MAX_LABEL_LEN) {
      return { ok: false, error: 'Invalid label.' }
    }
    value.label = label
  } else if (opts.requireAll) {
    return { ok: false, error: 'Missing label.' }
  }

  // date
  if (raw.date !== undefined) {
    const dateInput = parseDateInput(raw.date)
    if (!dateInput) {
      return { ok: false, error: 'Invalid date. Use YYYY-MM-DD.' }
    }
    value.dateInput = dateInput
  } else if (opts.requireAll) {
    return { ok: false, error: 'Missing date.' }
  }

  // notes (optional; null clears)
  if (raw.notes !== undefined) {
    if (raw.notes === null) {
      value.notes = null
    } else {
      const notes = pickString(raw.notes)?.trim() ?? ''
      if (notes.length > MAX_NOTES_LEN) {
        return { ok: false, error: 'Notes too long.' }
      }
      value.notes = notes.length ? notes : null
    }
  }

  // receiptMediaId (optional; null clears). Ownership is checked in the route.
  if (raw.receiptMediaId !== undefined) {
    if (raw.receiptMediaId === null) {
      value.receiptMediaId = null
    } else {
      const id = pickString(raw.receiptMediaId)?.trim()
      if (!id) {
        return { ok: false, error: 'Invalid receiptMediaId.' }
      }
      value.receiptMediaId = id
    }
  }

  return { ok: true, value }
}

// Resolve the stored money for a write: for a MILEAGE expense with logged miles,
// the deduction is computed server-side (rate stays authoritative) and the miles
// are recorded; otherwise the dollar amount is used and miles cleared. Shared by
// create + update so both stay consistent.
export type ResolvedExpenseAmount =
  | { ok: true; amountCents: number; mileageMiles: number | null }
  | { ok: false; error: string }

export function resolveExpenseAmount(args: {
  category: ExpenseCategory
  amountCents: number | undefined
  miles: number | undefined
}): ResolvedExpenseAmount {
  if (args.category === 'MILEAGE' && args.miles !== undefined) {
    return {
      ok: true,
      amountCents: computeMileageDeductionCents(args.miles),
      mileageMiles: args.miles,
    }
  }
  if (args.amountCents !== undefined) {
    return { ok: true, amountCents: args.amountCents, mileageMiles: null }
  }
  return {
    ok: false,
    error:
      args.category === 'MILEAGE'
        ? 'Enter the miles for this trip.'
        : 'Missing amount.',
  }
}

// A receipt image may only be attached to an expense by the pro who owns the
// media. Prevents a pro from referencing another pro's MediaAsset.
export async function receiptBelongsToPro(args: {
  receiptMediaId: string
  professionalId: string
}): Promise<boolean> {
  const media = await prisma.mediaAsset.findFirst({
    where: { id: args.receiptMediaId, professionalId: args.professionalId },
    select: { id: true },
  })

  return media != null
}
