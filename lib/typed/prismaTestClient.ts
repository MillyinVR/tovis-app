// lib/typed/prismaTestClient.ts
//
// TEST-ONLY nominal-type boundary for Prisma client fakes.
//
// Unit tests hand functions a small structural object ({ booking:
// { findUnique } … }) where the signature demands the full (nominal,
// enormous) Prisma.TransactionClient. That narrowing is unavoidable and
// safe — the fake only needs the methods the code under test calls — but it
// requires a type escape, and escapes are only allowed here in lib/typed
// with a justified boundary (tools/check-no-type-escape). Use this helper
// instead of scattering `as unknown as Prisma.TransactionClient` through
// test files.
//
// Never import from production code — production must always thread a real
// client.
import type { Prisma } from '@prisma/client'

export function asTestTransactionClient(
  fake: object,
): Prisma.TransactionClient {
  return fake as unknown as Prisma.TransactionClient
}
