// lib/pro/verification/methods.ts
//
// Single source of truth for which verification documents a pro can submit,
// keyed by profession. Used by the pro verification page (upload method list
// + document labels) and any onboarding surface that points pros at
// verification. Keep in sync with the admin review side, which renders the
// same VerificationDocumentType values.

import { ProfessionType, VerificationDocumentType } from '@prisma/client'

export type VerificationMethod = {
  type: VerificationDocumentType
  title: string
  description: string
}

const LICENSE_METHOD: VerificationMethod = {
  type: VerificationDocumentType.LICENSE,
  title: 'State license',
  description:
    'A clear photo of your current professional license or certification (front, readable).',
}

const ID_CARD_METHOD: VerificationMethod = {
  type: VerificationDocumentType.ID_CARD,
  title: 'Government ID',
  description:
    'A government-issued photo ID (driver license, state ID, or passport).',
}

const MAKEUP_PRIMARY_METHOD: VerificationMethod = {
  type: VerificationDocumentType.MAKEUP_PRIMARY,
  title: 'Makeup certificate',
  description:
    'Your primary makeup certification or course completion certificate.',
}

const MAKEUP_SECONDARY_METHOD: VerificationMethod = {
  type: VerificationDocumentType.MAKEUP_SECONDARY,
  title: 'Additional certificate',
  description:
    'Any additional certification that supports your makeup experience (optional).',
}

export function verificationMethodsForProfession(
  professionType: ProfessionType | null,
): VerificationMethod[] {
  if (professionType === ProfessionType.MAKEUP_ARTIST) {
    return [MAKEUP_PRIMARY_METHOD, MAKEUP_SECONDARY_METHOD, ID_CARD_METHOD]
  }

  return [LICENSE_METHOD, ID_CARD_METHOD]
}

const DOC_TYPE_LABELS: Record<VerificationDocumentType, string> = {
  [VerificationDocumentType.LICENSE]: 'State license',
  [VerificationDocumentType.ID_CARD]: 'Government ID',
  [VerificationDocumentType.MAKEUP_PRIMARY]: 'Makeup certificate',
  [VerificationDocumentType.MAKEUP_SECONDARY]: 'Additional certificate',
}

export function verificationDocTypeLabel(
  type: VerificationDocumentType,
): string {
  return DOC_TYPE_LABELS[type]
}
