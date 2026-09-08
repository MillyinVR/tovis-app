import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient, Role } from '@prisma/client'

import {
  awardFoundingProfessionalRecognition,
  FOUNDING_PROFESSIONAL_PROGRAM_ID,
} from '@/lib/founding/professionalRecognition'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `founding_recognition_${Date.now()}`
const rollbackMarker = `${tag}_rollback`
let tenantId = ''

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: tag, name: 'Founding recognition test' },
    select: { id: true },
  })
  tenantId = tenant.id
})

afterAll(async () => {
  await db.tenant.delete({ where: { id: tenantId } })
  await db.$disconnect()
})

describe('Founding 100 professional recognition', () => {
  it('atomically awards 001 and refuses a 101st seat', async () => {
    await expect(
      db.$transaction(async (tx) => {
        // This whole scenario rolls back. Resetting the shared allocator inside
        // this isolated transaction makes the boundary deterministic without
        // changing any fixture or another test's committed state.
        await tx.professionalProfile.updateMany({
          data: {
            foundingMemberNumber: null,
            foundingMemberAwardedAt: null,
          },
        })
        await tx.foundingProfessionalProgram.upsert({
          where: { id: FOUNDING_PROFESSIONAL_PROGRAM_ID },
          create: {
            id: FOUNDING_PROFESSIONAL_PROGRAM_ID,
            nextNumber: 1,
          },
          update: { nextNumber: 1 },
        })

        const firstUser = await tx.user.create({
          data: { email: `${tag}_first@example.test`, role: Role.PRO },
          select: { id: true },
        })
        const firstPro = await tx.professionalProfile.create({
          data: { userId: firstUser.id, homeTenantId: tenantId },
          select: { id: true },
        })

        await expect(
          awardFoundingProfessionalRecognition({
            tx,
            professionalId: firstPro.id,
          }),
        ).resolves.toBe(1)

        await expect(
          tx.professionalProfile.findUniqueOrThrow({
            where: { id: firstPro.id },
            select: { foundingMemberNumber: true },
          }),
        ).resolves.toEqual({ foundingMemberNumber: 1 })

        await tx.foundingProfessionalProgram.update({
          where: { id: FOUNDING_PROFESSIONAL_PROGRAM_ID },
          data: { nextNumber: 101 },
        })

        const lastUser = await tx.user.create({
          data: { email: `${tag}_last@example.test`, role: Role.PRO },
          select: { id: true },
        })
        const lastPro = await tx.professionalProfile.create({
          data: { userId: lastUser.id, homeTenantId: tenantId },
          select: { id: true },
        })

        await expect(
          awardFoundingProfessionalRecognition({
            tx,
            professionalId: lastPro.id,
          }),
        ).resolves.toBeNull()

        throw new Error(rollbackMarker)
      }),
    ).rejects.toThrow(rollbackMarker)
  })
})
