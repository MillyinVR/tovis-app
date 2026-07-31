// lib/consentForms/origin.ts
//
// K14 / D6 — where a consent form's words came from. Tori's decision was BOTH
// platform templates and pro-authored forms, with template provenance on the
// row "so a pro who EDITED a platform template is distinguishable from one who
// adopted it verbatim".
//
// Origin is DERIVED from the two columns that already record it
// (`ConsentForm.professionalId` and `ConsentForm.sourceTemplateId`) rather than
// stored a third time: a stored copy is one more thing that can disagree with
// the foreign keys, and this is a fact about provenance that must not drift.
// The verbatim half lives on the VERSION, because it is a fact about the text —
// a pro can adopt v1 unchanged and edit v2.

export type ConsentFormOrigin =
  /** Platform-owned template (professionalId is null). Adoptable by any pro. */
  | 'PLATFORM_TEMPLATE'
  /** A pro's own form, copied from a platform template. */
  | 'ADOPTED_TEMPLATE'
  /** A pro's own form, written from scratch. */
  | 'PRO_AUTHORED'

export function resolveConsentFormOrigin(form: {
  professionalId: string | null
  sourceTemplateId: string | null
}): ConsentFormOrigin {
  if (form.professionalId === null) return 'PLATFORM_TEMPLATE'
  return form.sourceTemplateId ? 'ADOPTED_TEMPLATE' : 'PRO_AUTHORED'
}

/**
 * One honest line about provenance, for the pro's form library and for any
 * surface that shows what a client signed.
 *
 * 🔴 An adopted template reports whether the words were CHANGED, which is the
 * whole point of D6's provenance requirement — "based on a platform template"
 * without that distinction would let an edited form borrow the platform's
 * authority. `verbatim` comes from the version row's computed
 * `verbatimFromTemplate`, never from anything the client sent.
 */
export function describeConsentFormOrigin(args: {
  origin: ConsentFormOrigin
  verbatim: boolean
}): string {
  switch (args.origin) {
    case 'PLATFORM_TEMPLATE':
      return 'Platform template'
    case 'ADOPTED_TEMPLATE':
      return args.verbatim
        ? 'Platform template, unchanged'
        : 'Platform template, edited'
    case 'PRO_AUTHORED':
      return 'Written by you'
  }
}
