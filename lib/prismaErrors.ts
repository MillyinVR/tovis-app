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
