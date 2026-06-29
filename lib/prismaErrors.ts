// lib/prismaErrors.ts
//
// Single source of truth for classifying Prisma runtime errors.

import { Prisma } from '@prisma/client'

/**
 * True for a Prisma unique-constraint violation (error code P2002), e.g. a
 * dedupe-key collision on an upsert. Narrows the error to the known-request
 * error type for callers that need the `meta`.
 */
export function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

/**
 * Prisma error codes for failures that are transient — the same operation may
 * well succeed if retried, because the cause is infrastructure pressure rather
 * than a logical conflict in the request. Used to gate one-shot retries (and
 * fail-safe degradation) on hot-path writes under load.
 */
const TRANSIENT_PRISMA_ERROR_CODES = new Set<string>([
  'P1001', // can't reach the database server
  'P1002', // database server reached but timed out
  'P1008', // operation timed out
  'P1017', // server has closed the connection
  'P2024', // timed out fetching a connection from the pool (pool exhaustion)
  'P2034', // write conflict / deadlock — the transaction should be retried
])

/**
 * True for a Prisma error that is transient (connection/pool/deadlock pressure)
 * and therefore worth retrying once, as opposed to a deterministic failure that
 * would recur. See {@link TRANSIENT_PRISMA_ERROR_CODES}.
 */
export function isTransientPrismaError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    TRANSIENT_PRISMA_ERROR_CODES.has(error.code)
  )
}

/**
 * True for a Postgres GIST EXCLUDE constraint violation (SQLSTATE 23P01) raised
 * by the named constraint. Prisma does not map 23P01 to a dedicated error code
 * for typed queries, so it surfaces as a known- or unknown-request error whose
 * message carries the constraint name; we match on that. Used by the booking
 * write boundary to convert an overlap-exclusion backstop trip into a clean
 * conflict instead of an opaque 500.
 */
export function isExclusionConstraintError(
  error: unknown,
  constraintName: string,
): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return error.message.includes(constraintName)
  }
  return false
}
