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

import type { BrandClientConsultThreadCopy } from '@/lib/brand/types'

export type ConsultThreadCopySlots = {
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
  const pro = slots.pro?.trim()
  const service = slots.service?.trim()
  const deadline = slots.deadline?.trim()
  if (pro) filled = filled.split('{pro}').join(pro)
  if (service) filled = filled.split('{service}').join(service)
  if (deadline) filled = filled.split('{deadline}').join(deadline)
  return filled
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
