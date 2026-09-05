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
  if (pro) filled = filled.split('{pro}').join(pro)
  if (service) filled = filled.split('{service}').join(service)
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
