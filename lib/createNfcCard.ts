// lib/createNfcCard.ts
import { NfcCardType, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { generateShortCode } from '@/lib/nfcShortCode'

type CreateNfcCardArgs = {
  type: NfcCardType
  isActive: boolean
  salonSlug: string | null
}

export async function createNfcCard(args: CreateNfcCardArgs) {
  const { type, isActive, salonSlug } = args

  // Try a few times in case of rare unique collisions
  for (let attempt = 0; attempt < 8; attempt++) {
    const shortCode = generateShortCode(8)

    try {
      return await prisma.nfcCard.create({
        data: {
          type,
          isActive,
          salonSlug,
          claimedAt: null,
          claimedByUserId: null,
          professionalId: null,
          shortCode,
        },
        select: {
          id: true,
          type: true,
          isActive: true,
          shortCode: true,
          createdAt: true,
        },
      })
    } catch (error: unknown) {
      // Prisma unique constraint error code is P2002
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        continue
      }

      throw error
    }
  }

  throw new Error('Failed to generate a unique NFC short code.')
}