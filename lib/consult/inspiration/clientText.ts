// The inspiration card's own names for the shared client-text rule
// (lib/consult/clientText.ts). Re-exports rather than a second implementation:
// intake and the thread follow-ups validate the same way, and the database
// guards are written against ONE limit, not three.
import {
  CONSULT_CLIENT_TEXT_LIMIT,
  validateConsultClientText,
} from '../clientText'

/** Client-authored context, never a model observation or an instruction. */
export const CONSULT_INSPIRATION_CLIENT_TEXT_LIMIT = CONSULT_CLIENT_TEXT_LIMIT

export const validateInspirationClientText = validateConsultClientText
