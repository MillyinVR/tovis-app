export type ConsultWriteErrorCode =
  | 'NOT_FOUND'
  | 'NOT_OWNER'
  | 'INVALID_REQUEST'
  | 'INVALID_STATE'
  | 'AGREEMENT_KIND_MISMATCH'
  | 'AGREEMENT_VERSION_MISMATCH'
  | 'AGREEMENTS_UNAVAILABLE'
  | 'AGREEMENTS_REQUIRED'
  | 'ALREADY_REVOKED'

export class ConsultWriteError extends Error {
  constructor(
    readonly code: ConsultWriteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConsultWriteError'
  }
}
