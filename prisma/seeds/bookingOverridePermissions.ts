import {
  BookingOverridePermissionScope,
  BookingOverrideRule,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'

type SeedPermissionInput = {
  actorUserId: string
  grantedByUserId: string | null
  rule: BookingOverrideRule
  scope: BookingOverridePermissionScope
  professionalId: string | null
  reason: string
  isActive?: boolean
  startsAt?: Date | null
  expiresAt?: Date | null
}

const PRO_USER_ID = 'cmmu9zguv0000jr04o1zysgco'
const PRO_PROFESSIONAL_ID = 'cmmu9zguw0001jr04dmid46j3'
const ADMIN_USER_ID = 'cmmuaff2e0000tzu47ti0d9j0'

const PERMISSIONS: SeedPermissionInput[] = [
  {
    actorUserId: PRO_USER_ID,
    grantedByUserId: ADMIN_USER_ID,
    rule: BookingOverrideRule.ADVANCE_NOTICE,
    scope: BookingOverridePermissionScope.SELF_ONLY,
    professionalId: PRO_PROFESSIONAL_ID,
    reason: 'Launch-approved self short-notice override',
    isActive: true,
  },
  {
    actorUserId: ADMIN_USER_ID,
    grantedByUserId: ADMIN_USER_ID,
    rule: BookingOverrideRule.WORKING_HOURS,
    scope: BookingOverridePermissionScope.PROFESSIONAL_TEAM,
    professionalId: PRO_PROFESSIONAL_ID,
    reason: 'Operational booking correction permission',
    isActive: true,
  },

  // Uncomment only if you truly need global any-pro permissions.
  /*
  {
    actorUserId: ADMIN_USER_ID,
    grantedByUserId: ADMIN_USER_ID,
    rule: BookingOverrideRule.MAX_DAYS_AHEAD,
    scope: BookingOverridePermissionScope.ANY_PROFESSIONAL,
    professionalId: null,
    reason: 'Emergency operational override permission',
    isActive: true,
  },
  */
]

async function assertUserExists(userId: string, label: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    throw new Error(`${label} does not exist in User.id: ${userId}`)
  }
}

async function assertProfessionalExists(
  professionalId: string,
  label: string,
): Promise<void> {
  const professional = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })

  if (!professional) {
    throw new Error(
      `${label} does not exist in ProfessionalProfile.id: ${professionalId}`,
    )
  }
}

async function upsertPermission(
  permission: SeedPermissionInput,
): Promise<void> {
  await assertUserExists(permission.actorUserId, 'actorUserId')

  if (permission.grantedByUserId) {
    await assertUserExists(permission.grantedByUserId, 'grantedByUserId')
  }

  if (permission.professionalId) {
    await assertProfessionalExists(permission.professionalId, 'professionalId')
  }

  const baseData = {
    grantedByUserId: permission.grantedByUserId,
    reason: permission.reason,
    isActive: permission.isActive ?? true,
    startsAt: permission.startsAt ?? null,
    expiresAt: permission.expiresAt ?? null,
    revokedAt: null,
    revokedByUserId: null,
  }

  if (permission.professionalId) {
    await prisma.bookingOverridePermission.upsert({
      where: {
        actorUserId_rule_scope_professionalId: {
          actorUserId: permission.actorUserId,
          rule: permission.rule,
          scope: permission.scope,
          professionalId: permission.professionalId,
        },
      },
      update: baseData,
      create: {
        actorUserId: permission.actorUserId,
        grantedByUserId: permission.grantedByUserId,
        rule: permission.rule,
        scope: permission.scope,
        professionalId: permission.professionalId,
        reason: permission.reason,
        isActive: permission.isActive ?? true,
        startsAt: permission.startsAt ?? null,
        expiresAt: permission.expiresAt ?? null,
      },
    })

    return
  }

  const existing = await prisma.bookingOverridePermission.findFirst({
    where: {
      actorUserId: permission.actorUserId,
      rule: permission.rule,
      scope: permission.scope,
      professionalId: null,
    },
    select: {
      id: true,
    },
  })

  if (existing) {
    await prisma.bookingOverridePermission.update({
      where: { id: existing.id },
      data: baseData,
    })
    return
  }

  await prisma.bookingOverridePermission.create({
    data: {
      actorUserId: permission.actorUserId,
      grantedByUserId: permission.grantedByUserId,
      rule: permission.rule,
      scope: permission.scope,
      professionalId: null,
      reason: permission.reason,
      isActive: permission.isActive ?? true,
      startsAt: permission.startsAt ?? null,
      expiresAt: permission.expiresAt ?? null,
    },
  })
}

async function main(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await upsertPermission(permission)
  }

  console.log(
    `Seeded ${PERMISSIONS.length} booking override permission record(s).`,
  )
}

main()
  .catch((error) => {
    console.error('Failed to seed booking override permissions:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })