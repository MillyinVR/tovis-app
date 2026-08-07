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
  }
}
