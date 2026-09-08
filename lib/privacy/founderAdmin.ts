import type { Prisma } from '@prisma/client'

import type { FounderAdminMemberDTO } from '@/lib/dto/founders'
import { prisma } from '@/lib/prisma'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'
import { normalizeEmail } from '@/lib/security/contactNormalization'

export type FounderEnrollmentAccount = {
  userId: string
  professionalId: string | null
  clientId: string | null
}

/** Keeps founder enrollment email handling inside the privacy boundary. */
export function normalizeFounderEnrollmentEmail(email: string): string | null {
  return normalizeEmail(email)
}

/** Exact account lookup boundary for a SUPER_ADMIN founder invitation. */
export async function findFounderEnrollmentAccountByEmail(
  email: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<FounderEnrollmentAccount | null> {
  const lookup = emailLookupHashV2(email)
  if (!lookup) return null

  const user = await db.user.findFirst({
    where: {
      emailHashV2: lookup.hash,
      emailHashKeyVersion: lookup.keyVersion,
    },
    select: {
      id: true,
      professionalProfile: { select: { id: true } },
      clientProfile: { select: { id: true } },
    },
  })

  return user
    ? {
        userId: user.id,
        professionalId: user.professionalProfile?.id ?? null,
        clientId: user.clientProfile?.id ?? null,
      }
    : null
}

export async function loadFounderAdminMembers(): Promise<
  FounderAdminMemberDTO[]
> {
  const members = await prisma.founderMember.findMany({
    orderBy: { joinedAt: 'asc' },
    select: {
      id: true,
      userId: true,
      audience: true,
      role: true,
      specialty: true,
      clientSlot: true,
      joinedAt: true,
      removedAt: true,
      user: {
        select: {
          clientProfile: {
            select: { firstName: true, lastName: true },
          },
          professionalProfile: {
            select: {
              businessName: true,
              firstName: true,
              lastName: true,
              handle: true,
              nameDisplay: true,
            },
          },
        },
      },
      sponsor: {
        select: {
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
        },
      },
    },
  })

  return members.map((member) => {
    const client = member.user.clientProfile
    const clientName = [client?.firstName, client?.lastName] // pii-plaintext-read-ok: SUPER_ADMIN founder roster
      .filter(Boolean)
      .join(' ')
      .trim()
    return {
      id: member.id,
      userId: member.userId,
      displayName:
        formatProfessionalPublicDisplayName(member.user.professionalProfile) ||
        clientName ||
        'Founder',
      audience: member.audience,
      role: member.role,
      specialty: member.specialty,
      clientSlot: member.clientSlot,
      sponsorName: member.sponsor
        ? formatProfessionalPublicDisplayName(member.sponsor)
        : null,
      joinedAt: member.joinedAt.toISOString(),
      removedAt: member.removedAt?.toISOString() ?? null,
    }
  })
}
