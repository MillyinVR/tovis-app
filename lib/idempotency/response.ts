import type { Prisma } from '@prisma/client'

export type IdempotencyResponseBody = Prisma.InputJsonValue

export type StoredIdempotencyResponse = {
  status: number
  body: IdempotencyResponseBody
}

export function toStoredIdempotencyResponse(args: {
  status: number
  body: IdempotencyResponseBody
}): StoredIdempotencyResponse {
  return {
    status: args.status,
    body: args.body,
  }
}
