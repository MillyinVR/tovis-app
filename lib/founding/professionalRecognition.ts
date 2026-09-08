import { Prisma } from '@prisma/client'

export const FOUNDING_PROFESSIONAL_PROGRAM_ID = 'founding-100'
export const FOUNDING_PROFESSIONAL_LIMIT = 100

type FoundingRecognitionTx = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | 'professionalProfile'
>

type AllocatedNumberRow = {
  foundingNumber: number
}

/**
 * Award an immutable Founding 100 number, when a seat remains.
 *
 * The counter increment and profile update share the account-creation
 * transaction. PostgreSQL serializes concurrent updates to the singleton row,
 * and a rolled-back signup also rolls its number back, so the public sequence
 * remains complete from 001 through 100 without duplicates or gaps.
 */
export async function awardFoundingProfessionalRecognition(args: {
  tx: FoundingRecognitionTx
  professionalId: string
}): Promise<number | null> {
  const rows = await args.tx.$queryRaw<AllocatedNumberRow[]>(Prisma.sql`
    INSERT INTO "FoundingProfessionalProgram" (
      "id",
      "nextNumber",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${FOUNDING_PROFESSIONAL_PROGRAM_ID},
      2,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE
    SET
      "nextNumber" = "FoundingProfessionalProgram"."nextNumber" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "FoundingProfessionalProgram"."nextNumber" <= ${FOUNDING_PROFESSIONAL_LIMIT}
    RETURNING "nextNumber" - 1 AS "foundingNumber"
  `)

  const foundingNumber = rows[0]?.foundingNumber ?? null
  if (foundingNumber == null) return null

  await args.tx.professionalProfile.update({
    where: { id: args.professionalId },
    data: {
      foundingMemberNumber: foundingNumber,
      foundingMemberAwardedAt: new Date(),
    },
  })

  return foundingNumber
}

export function formatFoundingMemberNumber(value: number): string {
  return String(value).padStart(3, '0')
}
