// lib/finance/proFinanceScheduleCPdf.ts
//
// "Schedule C Ready" PDF — a one-page summary that maps the pro's income +
// expense-category totals onto IRS Schedule C (Form 1040) line numbers, so they
// or their CPA can transcribe it onto the form. This is a summary to help fill
// the form, NOT the form itself, and the mappings are honest simplifications
// (see SCHEDULE_C_LINE) — the PDF says so.
import 'server-only'

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { formatCents } from '@/lib/money'

import { computeEstimatedTaxCents } from '@/lib/finance/proFinanceSummary'
import {
  exportScopeLabel,
  gatherFinanceExportData,
  type FinanceExportScope,
} from '@/lib/finance/financeExportData'
import { SCHEDULE_C_LINE } from '@/lib/finance/expenseCategories'

export type ScheduleCPdfResult = {
  filename: string
  bytes: Uint8Array
}

type LineGroup = { line: string; label: string; cents: number }

const INK = rgb(0.1, 0.12, 0.11)
const MUTED = rgb(0.42, 0.45, 0.44)
const RULE = rgb(0.8, 0.82, 0.81)

export async function buildScheduleCPdf(args: {
  professionalId: string
  timeZone: string | null | undefined
  scope: FinanceExportScope
  selectedMonthKey: string
  brandName: string
  businessName?: string | null
}): Promise<ScheduleCPdfResult> {
  const data = await gatherFinanceExportData({
    professionalId: args.professionalId,
    timeZone: args.timeZone,
    scope: args.scope,
    selectedMonthKey: args.selectedMonthKey,
  })

  // Group deductible expenses onto Schedule C lines; keep non-deductible aside.
  const byLine = new Map<string, LineGroup>()
  let nonDeductibleCents = 0
  for (const expense of data.expenses) {
    const mapping = SCHEDULE_C_LINE[expense.category]
    if (mapping.line == null) {
      nonDeductibleCents += expense.amountCents
      continue
    }
    const group = byLine.get(mapping.line) ?? {
      line: mapping.line,
      label: mapping.label,
      cents: 0,
    }
    group.cents += expense.amountCents
    byLine.set(mapping.line, group)
  }
  const lineGroups = [...byLine.values()].sort(
    (a, b) => Number.parseInt(a.line, 10) - Number.parseInt(b.line, 10),
  )
  const deductibleTotalCents = lineGroups.reduce((sum, g) => sum + g.cents, 0)
  const netProfitCents = data.incomeTotalCents - deductibleTotalCents
  const estTaxCents = computeEstimatedTaxCents(netProfitCents)

  const scopeLabel = exportScopeLabel(args.scope, args.selectedMonthKey)
  const periodLabel =
    data.monthKeys.length === 1
      ? data.monthKeys[0]
      : `${data.monthKeys[0]} – ${data.monthKeys.at(-1)}`

  // ── Draw ──────────────────────────────────────────────────────────────────
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${args.brandName} — Schedule C Summary`)
  const page = pdf.addPage([612, 792]) // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const left = 56
  const right = 612 - 56
  let y = 792 - 64

  const text = (
    s: string,
    x: number,
    size: number,
    f = font,
    color = INK,
  ) => page.drawText(s, { x, y, size, font: f, color })

  const amountRight = (s: string, size: number, f = font, color = INK) => {
    const w = f.widthOfTextAtSize(s, size)
    page.drawText(s, { x: right - w, y, size, font: f, color })
  }

  const rule = () => {
    page.drawLine({
      start: { x: left, y: y + 6 },
      end: { x: right, y: y + 6 },
      thickness: 0.75,
      color: RULE,
    })
  }

  // Header
  text(args.businessName?.trim() || args.brandName, left, 18, bold)
  y -= 20
  text('Schedule C (Form 1040) — Profit or Loss From Business, summary', left, 10, font, MUTED)
  y -= 14
  text(`Tax year ${args.selectedMonthKey.slice(0, 4)}  ·  Period ${periodLabel}`, left, 10, font, MUTED)
  y -= 26

  // Part I — Income
  text('Part I — Income', left, 12, bold)
  y -= 18
  const incomeRow = (label: string, cents: number, strong = false) => {
    text(label, left, 11, strong ? bold : font)
    amountRight(formatCents(cents), 11, strong ? bold : font)
    y -= 16
  }
  incomeRow('Services', data.serviceCents)
  incomeRow('Tips', data.tipCents)
  incomeRow('Product sales', data.productCents)
  rule()
  y -= 4
  incomeRow('Line 1 — Gross receipts', data.incomeTotalCents, true)
  y -= 12

  // Part II — Expenses by Schedule C line
  text('Part II — Expenses', left, 12, bold)
  y -= 18
  if (lineGroups.length === 0) {
    text('No deductible expenses recorded for this period.', left, 11, font, MUTED)
    y -= 16
  } else {
    for (const group of lineGroups) {
      text(`Line ${group.line} — ${group.label}`, left, 11)
      amountRight(formatCents(group.cents), 11)
      y -= 16
    }
  }
  rule()
  y -= 4
  text('Line 28 — Total expenses', left, 11, bold)
  amountRight(formatCents(deductibleTotalCents), 11, bold)
  y -= 22

  // Net + estimate
  text('Line 31 — Net profit', left, 12, bold)
  amountRight(formatCents(netProfitCents), 12, bold)
  y -= 18
  text('Estimated tax set-aside (~28%)', left, 11, font, MUTED)
  amountRight(formatCents(estTaxCents), 11, font, MUTED)
  y -= 22

  if (nonDeductibleCents > 0) {
    text(
      `Excluded as not deductible: ${formatCents(nonDeductibleCents)} (e.g. appearance/clothing).`,
      left,
      10,
      font,
      MUTED,
    )
    y -= 20
  }

  // Disclaimer
  y = 96
  page.drawLine({
    start: { x: left, y: y + 14 },
    end: { x: right, y: y + 14 },
    thickness: 0.75,
    color: RULE,
  })
  const disclaimer =
    'This is a summary to help fill Schedule C — not the IRS form and not tax advice. Line mappings ' +
    'are simplifications (insurance vs. licenses, home office via Form 8829, equipment depreciation, ' +
    'and non-deductible appearance costs may differ). Verify with a tax professional before filing.'
  for (const wline of wrapText(disclaimer, font, 9, right - left)) {
    text(wline, left, 9, font, MUTED)
    y -= 12
  }

  const bytes = await pdf.save()
  return { filename: `schedule-c-${scopeLabel}.pdf`, bytes }
}

// Greedy word-wrap to a pixel width for the disclaimer block.
function wrapText(
  content: string,
  font: import('pdf-lib').PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = content.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}
