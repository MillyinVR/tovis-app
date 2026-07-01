// lib/finance/receiptInbox.ts
//
// Helpers for the pro's receipt inbox — the review queue behind the CosmoProf /
// Salon Centric import and the <handle>@tovis.me email-forwarding path. Nothing
// here writes; the confirm-to-expense transaction lives in the route so it can
// compose the expense-write helpers.
import 'server-only'

import type { ReceiptSource } from '@prisma/client'

import { formatCents } from '@/lib/money'
import { formatInTimeZone, getZonedParts } from '@/lib/time'

// The domain a pro's forwarding address lives on. Kept here so the webhook and
// the UI agree on it; override per-env if the inbound domain differs.
export const RECEIPT_INBOX_DOMAIN =
  process.env.RECEIPT_INBOX_DOMAIN?.trim() || 'tovis.me'

// A pro's receipt-forwarding address, e.g. "jadehair@tovis.me". Available only
// to premium pros who've claimed a handle (the address IS the handle) — that's
// what ties a forwarded email back to this pro. Returns null when unavailable.
export function resolveReceiptInboxAddress(args: {
  handle: string | null | undefined
  isPremium: boolean
}): string | null {
  const handle = args.handle?.trim()
  if (!args.isPremium || !handle) return null
  return `${handle}@${RECEIPT_INBOX_DOMAIN}`
}

const SOURCE_LABEL: Record<ReceiptSource, string> = {
  UPLOAD: 'Uploaded',
  EMAIL: 'Forwarded email',
  COSMOPROF: 'CosmoProf',
  SALON_CENTRIC: 'Salon Centric',
}

export type ProReceiptInboxItem = {
  id: string
  source: ReceiptSource
  sourceLabel: string
  /** A human title: parsed vendor, else email subject, else a generic label. */
  title: string
  receivedAtIso: string
  receivedLabel: string
  parsedAmountCents: number | null
  parsedAmountLabel: string | null
  /** "YYYY-MM-DD" hint to prefill the confirm form (parsed date, pro's tz). */
  dateHint: string | null
  emailFrom: string | null
  hasReceipt: boolean
  receiptMediaId: string | null
}

export function serializeReceiptInboxItem(
  row: {
    id: string
    source: ReceiptSource
    parsedAmountCents: number | null
    parsedVendor: string | null
    parsedDate: Date | null
    emailFrom: string | null
    emailSubject: string | null
    receivedAt: Date
    receiptMediaId: string | null
  },
  timeZone: string,
): ProReceiptInboxItem {
  const title =
    row.parsedVendor?.trim() ||
    row.emailSubject?.trim() ||
    (row.source === 'UPLOAD' ? 'Uploaded receipt' : 'Receipt')

  return {
    id: row.id,
    source: row.source,
    sourceLabel: SOURCE_LABEL[row.source],
    title,
    receivedAtIso: row.receivedAt.toISOString(),
    receivedLabel: formatInTimeZone(
      row.receivedAt,
      timeZone,
      { month: 'short', day: 'numeric' },
      'en-US',
    ),
    parsedAmountCents: row.parsedAmountCents,
    parsedAmountLabel:
      row.parsedAmountCents != null ? formatCents(row.parsedAmountCents) : null,
    dateHint: row.parsedDate ? dateHintInTimeZone(row.parsedDate, timeZone) : null,
    emailFrom: row.emailFrom,
    hasReceipt: row.receiptMediaId != null,
    receiptMediaId: row.receiptMediaId,
  }
}

function dateHintInTimeZone(instant: Date, timeZone: string): string {
  const parts = getZonedParts(instant, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

// ── Inbound email parsing (used by the Postmark inbound webhook) ─────────────

// The recipient handle from an inbound address (<handle>@<inbox-domain>), from
// the most reliable recipient field available. Returns null if none match.
export function extractInboxHandle(candidates: readonly string[]): string | null {
  const domain = RECEIPT_INBOX_DOMAIN.toLowerCase()
  for (const raw of candidates) {
    const match = /([^\s<@]+)@([^\s>]+)/.exec(raw.toLowerCase())
    if (match && match[2] === domain && match[1]) return match[1]
  }
  return null
}

// Largest "$1,234.56" in the text — a heuristic for the order total (the pro
// confirms, so a rough hint is enough).
export function parseReceiptAmountCents(text: string): number | null {
  const matches = [...text.matchAll(/\$\s?([0-9][0-9,]*\.[0-9]{2})/g)]
  if (matches.length === 0) return null
  const cents = matches.map((m) =>
    Math.round(Number.parseFloat((m[1] ?? '0').replaceAll(',', '')) * 100),
  )
  const max = Math.max(...cents)
  return Number.isFinite(max) && max > 0 ? max : null
}

export function detectReceiptVendor(
  hay: string,
): { source: ReceiptSource; vendor: string | null } {
  const lower = hay.toLowerCase()
  if (lower.includes('cosmoprof')) return { source: 'COSMOPROF', vendor: 'CosmoProf' }
  if (lower.includes('saloncentric') || lower.includes('salon centric')) {
    return { source: 'SALON_CENTRIC', vendor: 'Salon Centric' }
  }
  return { source: 'EMAIL', vendor: null }
}
