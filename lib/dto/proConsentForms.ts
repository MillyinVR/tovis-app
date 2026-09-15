// The pro consent-form LIBRARY wire contract —
// GET /api/v1/pro/consent-forms.
//
// K14 built the library and gave it three write routes (create/adopt, publish a
// version, retire/restore) and NO read route: the only thing that ever showed a
// pro their own forms was `/pro/forms`, a server component calling
// `loadProConsentFormLibrary` directly. So a pro on a phone could attach a form
// to a record and send a signing link, and could never write one — the exact
// shape of gap `lib/consentForms/loader.ts` anticipated when it said the loader
// was extracted "so the K17 native route can reuse the exact same shaping
// instead of growing a second, drifting copy".
//
// This is that contract. The route reuses the loader untouched; the only work
// here is making its output JSON-safe (`publishedAt` is a `Date`) and declaring
// the result so the generated schema — and therefore the iOS fixtures — can hold
// it to its shape.

import type { ClientConsentKind } from '@prisma/client'

import {
  CONSENT_FORM_BODY_MAX,
  CONSENT_FORM_TITLE_MAX,
} from '@/lib/consentForms/formText'
import type {
  ConsentFormView,
  ProConsentFormLibrary,
} from '@/lib/consentForms/loader'
import type { ConsentFormOrigin } from '@/lib/consentForms/origin'

/**
 * The current text of a form. Identical to the loader's
 * `ConsentFormVersionView` except that `publishedAt` is an ISO instant.
 */
export type ProConsentFormLibraryVersionDTO = {
  id: string
  /** The version NUMBER — 3 means "v3", not "the 3rd form". */
  version: number
  title: string
  body: string
  /** ISO instant. */
  publishedAt: string
  /** Whether these words are still the platform template's, byte for byte. */
  verbatimFromTemplate: boolean
}

/** One form in the pro's own library. */
export type ProConsentFormLibraryItemDTO = {
  id: string
  kind: ClientConsentKind
  /** False = retired: kept for the records signed against it, offered to none. */
  isActive: boolean
  origin: ConsentFormOrigin
  /**
   * Provenance in words, composed by `describeConsentFormOrigin`. Rendered
   * verbatim and never re-derived on a device: the rule that distinguishes an
   * adopted template from an EDITED one is the whole of D6, and a second
   * spelling of it is how an edited form borrows the platform's authority.
   */
  originLabel: string
  /** Null only for a form whose versions were never published — never expected. */
  currentVersion: ProConsentFormLibraryVersionDTO | null
  versionCount: number
  /** Consent records pointing at ANY version of this form. */
  signatureCount: number
}

/** A platform template on offer, plus whether this pro already adopted it. */
export type ProConsentFormTemplateDTO = ProConsentFormLibraryItemDTO & {
  adopted: boolean
}

/**
 * The limits the write routes enforce, so a client can stop a pro at the field
 * instead of letting `parseConsentFormText` refuse a waiver they already typed.
 *
 * On the wire rather than hard-coded native-side deliberately: these are the
 * numbers `lib/consentForms/formText.ts` refuses against, and a device holding
 * its own copy is a device that silently disagrees with the server the day one
 * of them moves.
 */
export type ProConsentFormLimitsDTO = {
  titleMax: number
  bodyMax: number
}

export type ProConsentFormLibraryResponseDTO = {
  forms: ProConsentFormLibraryItemDTO[]
  templates: ProConsentFormTemplateDTO[]
  limits: ProConsentFormLimitsDTO
}

function toItemDTO(view: ConsentFormView): ProConsentFormLibraryItemDTO {
  return {
    id: view.id,
    kind: view.kind,
    isActive: view.isActive,
    origin: view.origin,
    originLabel: view.originLabel,
    currentVersion: view.currentVersion
      ? {
          id: view.currentVersion.id,
          version: view.currentVersion.version,
          title: view.currentVersion.title,
          body: view.currentVersion.body,
          publishedAt: view.currentVersion.publishedAt.toISOString(),
          verbatimFromTemplate: view.currentVersion.verbatimFromTemplate,
        }
      : null,
    versionCount: view.versionCount,
    signatureCount: view.signatureCount,
  }
}

/**
 * Serialize the loader's library for the wire. The ONLY transformation is
 * `publishedAt` → ISO; everything else is already JSON-safe, and the field list
 * is written out rather than spread so a field added to the loader has to be
 * declared here before it can travel ([[a-spread-hides-a-field-from-the-dto]]).
 */
export function buildProConsentFormLibraryDTO(
  library: ProConsentFormLibrary,
): ProConsentFormLibraryResponseDTO {
  return {
    forms: library.forms.map(toItemDTO),
    templates: library.templates.map((template) => ({
      ...toItemDTO(template),
      adopted: template.adopted,
    })),
    limits: {
      titleMax: CONSENT_FORM_TITLE_MAX,
      bodyMax: CONSENT_FORM_BODY_MAX,
    },
  }
}
