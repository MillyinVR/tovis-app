import { jsonFail } from '@/app/api/_utils'
import { ConsultWriteError } from '@/lib/consult/errors'
import type { ConsultAgreementErrorCode } from '@/lib/dto/consult'

export const CONSULT_NOT_FOUND_RESPONSE = {
  status: 404,
  message: 'Not found.',
  code: 'CONSULT_NOT_FOUND',
} as const

export function consultAgreementFail(
  status: number,
  message: string,
  code: ConsultAgreementErrorCode,
): Response {
  return jsonFail(status, message, { code })
}

export function consultNotFoundResponse(): Response {
  return consultAgreementFail(
    CONSULT_NOT_FOUND_RESPONSE.status,
    CONSULT_NOT_FOUND_RESPONSE.message,
    CONSULT_NOT_FOUND_RESPONSE.code,
  )
}

export function consultWriteErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ConsultWriteError)) return null

  switch (error.code) {
    case 'NOT_FOUND':
    case 'NOT_OWNER':
      return consultNotFoundResponse()
    case 'AGREEMENTS_UNAVAILABLE':
      return consultAgreementFail(
        503,
        'Consult agreements are unavailable.',
        'CONSULT_AGREEMENTS_UNAVAILABLE',
      )
    case 'AGREEMENT_VERSION_MISMATCH':
    case 'AGREEMENT_KIND_MISMATCH':
      return consultAgreementFail(
        409,
        'The agreement version is no longer current.',
        'CONSULT_AGREEMENT_VERSION_MISMATCH',
      )
    case 'INVALID_STATE':
      return consultAgreementFail(
        409,
        'The consult is not in a valid lifecycle state.',
        'CONSULT_INVALID_STATE',
      )
    case 'AGREEMENTS_REQUIRED':
      return consultAgreementFail(
        409,
        'Current consent and 18+ attestation are required.',
        'CONSULT_PREREQUISITES_REQUIRED',
      )
    case 'ALREADY_REVOKED':
      return consultAgreementFail(
        409,
        'The agreement acceptance is already revoked.',
        'CONSULT_ACCEPTANCE_ALREADY_REVOKED',
      )
    case 'INVALID_REQUEST':
      return consultAgreementFail(
        400,
        'Invalid request.',
        'CONSULT_INVALID_REQUEST',
      )
    case 'PACK_VERSION_MISMATCH':
      return consultAgreementFail(
        409,
        'The intake pack version is no longer current.',
        'CONSULT_PACK_VERSION_MISMATCH',
      )
    case 'SCHEMA_VERSION_MISMATCH':
      return consultAgreementFail(
        409,
        'The intake schema version is no longer current.',
        'CONSULT_SCHEMA_VERSION_MISMATCH',
      )
    case 'INVALID_ANSWERS':
      return consultAgreementFail(
        400,
        'Invalid intake answers.',
        'CONSULT_INVALID_ANSWERS',
      )
    case 'GOAL_DIRECTION_REQUIRED':
      return consultAgreementFail(
        409,
        'Choose what part of the color you want to change before continuing.',
        'CONSULT_GOAL_DIRECTION_REQUIRED',
      )
    case 'GOAL_DIRECTION_UNRESOLVED':
      return consultAgreementFail(
        409,
        'Your color goal is still unclear. Review the goal question before continuing.',
        'CONSULT_GOAL_DIRECTION_UNRESOLVED',
      )
    case 'IDEMPOTENCY_CONFLICT':
      return consultAgreementFail(
        409,
        'The idempotency key was already used.',
        'CONSULT_IDEMPOTENCY_CONFLICT',
      )
    case 'BOOKING_INELIGIBLE':
      return consultAgreementFail(
        409,
        'The consult is unavailable for this booking.',
        'CONSULT_BOOKING_INELIGIBLE',
      )
    case 'CAPTURE_PACK_VERSION_MISMATCH':
      return consultAgreementFail(
        409,
        'The capture pack version is no longer current.',
        'CONSULT_CAPTURE_PACK_VERSION_MISMATCH',
      )
    case 'CAPTURE_SCHEMA_VERSION_MISMATCH':
      return consultAgreementFail(
        409,
        'The capture schema version is no longer current.',
        'CONSULT_CAPTURE_SCHEMA_VERSION_MISMATCH',
      )
    case 'CAPTURE_INVALID_SLOT':
      return consultAgreementFail(
        400,
        'Invalid capture slot.',
        'CONSULT_CAPTURE_INVALID_SLOT',
      )
    case 'CAPTURE_UPLOAD_EXPIRED':
      return consultAgreementFail(
        410,
        'The capture upload has expired.',
        'CONSULT_CAPTURE_UPLOAD_EXPIRED',
      )
    case 'CAPTURE_UPLOAD_MISMATCH':
      return consultAgreementFail(
        409,
        'The capture upload does not match this request.',
        'CONSULT_CAPTURE_UPLOAD_MISMATCH',
      )
    case 'CAPTURE_OBJECT_INVALID':
      return consultAgreementFail(
        422,
        'The uploaded capture is missing or malformed.',
        'CONSULT_CAPTURE_OBJECT_INVALID',
      )
    case 'CAPTURE_QUALITY_UNAVAILABLE':
      return consultAgreementFail(
        503,
        'Capture quality checking is unavailable.',
        'CONSULT_CAPTURE_QUALITY_UNAVAILABLE',
      )
    case 'CAPTURE_QUALITY_FAILED':
      return consultAgreementFail(
        422,
        'The capture did not pass the quality gate.',
        'CONSULT_CAPTURE_QUALITY_FAILED',
      )
    case 'CAPTURE_STORAGE_UNAVAILABLE':
      return consultAgreementFail(
        503,
        'Private capture storage is unavailable.',
        'CONSULT_CAPTURE_STORAGE_UNAVAILABLE',
      )
    case 'ANALYSIS_SCHEMA_VERSION_MISMATCH':
      return consultAgreementFail(
        409,
        'The analysis schema version is no longer current.',
        'CONSULT_ANALYSIS_SCHEMA_VERSION_MISMATCH',
      )
    case 'ANALYSIS_PROMPT_VERSION_MISMATCH':
      return consultAgreementFail(
        409,
        'The analysis prompt version is no longer current.',
        'CONSULT_ANALYSIS_PROMPT_VERSION_MISMATCH',
      )
    case 'ANALYSIS_PREREQUISITES_REQUIRED':
      return consultAgreementFail(
        409,
        'Current completed intake and captures are required.',
        'CONSULT_ANALYSIS_PREREQUISITES_REQUIRED',
      )
    case 'ANALYSIS_UNAVAILABLE':
      return consultAgreementFail(
        503,
        'Consult analysis is unavailable.',
        'CONSULT_ANALYSIS_UNAVAILABLE',
      )
    case 'INSPIRATION_SCHEMA_VERSION_MISMATCH':
      return consultAgreementFail(409, 'The inspiration schema version is no longer current.', 'CONSULT_INSPIRATION_SCHEMA_VERSION_MISMATCH')
    case 'INSPIRATION_LOOK_UNAVAILABLE':
      return consultAgreementFail(404, 'The selected Look is unavailable.', 'CONSULT_INSPIRATION_LOOK_UNAVAILABLE')
    case 'INSPIRATION_SOURCE_REQUIRED':
      return consultAgreementFail(409, 'Choose an inspiration source before continuing.', 'CONSULT_INSPIRATION_SOURCE_REQUIRED')
    case 'INSPIRATION_SOURCE_UNAVAILABLE':
      return consultAgreementFail(409, 'The inspiration source is no longer available.', 'CONSULT_INSPIRATION_SOURCE_UNAVAILABLE')
    case 'INSPIRATION_UPLOAD_EXPIRED':
      return consultAgreementFail(410, 'The inspiration upload has expired.', 'CONSULT_INSPIRATION_UPLOAD_EXPIRED')
    case 'INSPIRATION_UPLOAD_MISMATCH':
      return consultAgreementFail(409, 'The inspiration upload does not match this request.', 'CONSULT_INSPIRATION_UPLOAD_MISMATCH')
    case 'INSPIRATION_OBJECT_INVALID':
      return consultAgreementFail(422, 'The uploaded inspiration is missing or malformed.', 'CONSULT_INSPIRATION_OBJECT_INVALID')
    case 'INSPIRATION_STORAGE_UNAVAILABLE':
      return consultAgreementFail(503, 'Private inspiration storage is unavailable.', 'CONSULT_INSPIRATION_STORAGE_UNAVAILABLE')
    case 'INSPIRATION_INVALID_ANSWER':
      return consultAgreementFail(400, 'Invalid inspiration answer.', 'CONSULT_INSPIRATION_INVALID_ANSWER')
    case 'INSPIRATION_QUESTION_OUT_OF_ORDER':
      return consultAgreementFail(409, 'Answer the current inspiration question first.', 'CONSULT_INSPIRATION_QUESTION_OUT_OF_ORDER')
  }
}
