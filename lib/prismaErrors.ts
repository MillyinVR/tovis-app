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
