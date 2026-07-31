// lib/consentForms/kindLabels.ts
//
// K14 — the one place a `ClientConsentKind` becomes words. Two surfaces name
// these now (the chart's record-entry form and the pro's form library) and K15
// will add a third; a per-surface copy is how "Service waiver" and "Waiver" end
// up on the same screen.

import { ClientConsentKind } from '@prisma/client'

export const CONSENT_KIND_LABELS: Record<ClientConsentKind, string> = {
  GENERAL_CONSENT: 'General consent',
  SERVICE_WAIVER: 'Service waiver',
  PATCH_TEST: 'Patch test',
}

export const CONSENT_KINDS = Object.keys(
  CONSENT_KIND_LABELS,
) as ClientConsentKind[]
