// lib/consult/threadCopy.ts
//
// P5a — the ONE place a consult thread bubble's slots get filled.
//
// The sentences live in lib/brand/defaultClientConsultThreadCopy.ts so they can
// be edited without touching code; this fills `{pro}` and `{service}` in them.
// Callers ask for a filled sentence and never assemble one, which is what keeps
// `check:no-hardcoded-brand-strings` honest and what stops two surfaces drifting
// into two different greetings.
//
// The native twin is tovis-ios `TovisKit/Sources/TovisKit/Consult/
// ConsultThreadCopy.swift`. It holds only the sentences the DEVICE composes;
// every bubble the server composes arrives on the wire already filled.

import { formatCents } from '@/lib/money'
import type { UpfrontChargeDisclosure } from '@/lib/booking/categoryDeposit'
import type { BrandClientConsultThreadCopy } from '@/lib/brand/types'

export type ConsultThreadCopySlots = {
  date?: string | null
  answer?: string | null
  /** The professional's public display name. */
  pro?: string | null
  /** The service in the client's own language, where one resolves. */
  service?: string | null
  /**
   * P7a-4 — the prep deadline, ALREADY FORMATTED in the client's zone by the
   * caller (`@/lib/time`). A slot takes a string, never a Date: this module
   * substitutes, it does not decide what a date looks like, and a formatter
   * reached from here would be one that never saw a timezone.
   */
  deadline?: string | null
  /**
   * P7a-5 — a money amount, ALREADY FORMATTED by the caller through
   * `@/lib/money`. A slot takes a string for the same reason `deadline` does:
   * this module substitutes, it does not decide what money looks like.
   */
  amount?: string | null
  /** P7a-5 — a deposit percentage, as a bare integer ("20" for 20%). */
  percent?: string | null
}

/**
 * Fill `{pro}` / `{service}` in one copy sentence.
 *
 * An unfilled slot is left ALONE rather than replaced with an empty string: a
 * sentence that reads "You're on 's calendar" is worse than one that never got
 * rendered, so callers choose a slot-free variant (`opening` vs
 * `openingWithService`) when a value may be missing. This function's job is
 * substitution, not deciding which sentence to use.
 */
export function fillConsultThreadCopy(
  template: string,
  slots: ConsultThreadCopySlots,
): string {
  let filled = template
  if (slots.date?.trim()) filled = filled.split('{date}').join(slots.date.trim())
  if (slots.answer?.trim()) filled = filled.split('{answer}').join(slots.answer.trim())
  const pro = slots.pro?.trim()
  const service = slots.service?.trim()
  const deadline = slots.deadline?.trim()
  const amount = slots.amount?.trim()
  const percent = slots.percent?.trim()
  if (pro) filled = filled.split('{pro}').join(pro)
  if (service) filled = filled.split('{service}').join(service)
  if (deadline) filled = filled.split('{deadline}').join(deadline)
  if (amount) filled = filled.split('{amount}').join(amount)
  if (percent) filled = filled.split('{percent}').join(percent)
  return filled
}

/**
 * P7a-5 — the money line under the sticky CTA: "From $180 · $25 deposit".
 *
 * Composed HERE, on the server, and sent whole. Two numbers on the wire would
 * be two numbers each client joins by hand, and a look already read
 * "From $249.5" in one place and "From $250" in another the last time a price
 * label was assembled per surface (lib/looks/startingPrice.ts).
 *
 * Either half may be absent and the note degrades cleanly: a look with no price
 * still discloses its deposit, and a booking that owes nothing up front still
 * shows "From $180". Both absent is null, which every client renders as no
 * line rather than an empty one.
 */
export function consultThreadBookPriceNote(
  copy: BrandClientConsultThreadCopy,
  args: {
    /** `formatLookStartingPrice(look.priceStartingAt)` — never assembled here. */
    priceLabel: string | null
    /** `describeUpfrontChargeDisclosure(...)`, or null when nothing is owed. */
    charge: UpfrontChargeDisclosure | null
  },
): string | null {
  const parts: string[] = []
  const price = args.priceLabel?.trim()
  if (price) parts.push(price)

  const charge = args.charge
  if (charge) {
    if (charge.kind === 'PREPAY') {
      parts.push(copy.bookCtaPrepay)
    } else if (charge.kind === 'FLAT') {
      parts.push(
        fillConsultThreadCopy(copy.bookCtaDepositFlat, {
          // `formatCents`, not the rounded label the price half uses. "From
          // $180" is an estimate and rounds; "$25.00" is the exact amount the
          // tap will charge, and rounding a real charge is how a client meets a
          // number she was never shown.
          amount: formatCents(charge.amountCents),
        }),
      )
    } else {
      parts.push(
        fillConsultThreadCopy(copy.bookCtaDepositPercent, {
          percent: String(charge.percent),
        }),
      )
    }
  }

  return parts.length > 0 ? parts.join(copy.bookCtaNoteSeparator) : null
}

/** The opening bubble, which has a service-aware variant and a plain one. */
export function consultThreadOpening(
  copy: BrandClientConsultThreadCopy,
  slots: ConsultThreadCopySlots,
): string {
  const service = slots.service?.trim()
  return fillConsultThreadCopy(
    service ? copy.openingWithService : copy.opening,
    slots,
  )
}
