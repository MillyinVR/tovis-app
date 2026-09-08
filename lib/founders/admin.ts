import {
  FounderAudience,
  FounderMemberRole,
  FounderMemberStatus,
  type FounderSpecialty,
} from '@prisma/client'

import type { FounderAdminSummaryDTO } from '@/lib/dto/founders'
import {
  FOUNDER_MESSAGE_SELECT,
  founderMessageDTO,
} from '@/lib/founders/portal'
import { prisma } from '@/lib/prisma'
import {
  findFounderEnrollmentAccountByEmail,
  loadFounderAdminMembers,
  normalizeFounderEnrollmentEmail,
} from '@/lib/privacy/founderAdmin'

export const FOUNDER_PROGRAM_ID = 'founders-2026'
export const FOUNDER_PRO_LIMIT = 100

export class FounderEnrollmentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function founderAdminSummary(): Promise<FounderAdminSummaryDTO> {
  const [program, activeClients, unansweredQuestions, reports, members] =
    await Promise.all([
      prisma.founderProgram.findUnique({
        where: { id: FOUNDER_PROGRAM_ID },
        select: { proSeatsUsed: true },
      }),
      prisma.founderMember.count({
        where: {
          audience: FounderAudience.CLIENT,
          status: FounderMemberStatus.ACTIVE,
        },
      }),
      prisma.founderMessage.count({
        where: {
          kind: 'QUESTION',
          answeredAt: null,
          hiddenAt: null,
        },
      }),
      prisma.founderMessageReport.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          reason: true,
          details: true,
          createdAt: true,
          message: { select: FOUNDER_MESSAGE_SELECT },
        },
      }),
      loadFounderAdminMembers(),
    ])
  const proSeatsUsed = program?.proSeatsUsed ?? 0
  return {
    proSeatsUsed,
    proSeatsRemaining: Math.max(0, FOUNDER_PRO_LIMIT - proSeatsUsed),
    activeClients,
    unansweredQuestions,
    openReports: reports.length,
    reports: reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      details: report.details,
      createdAt: report.createdAt.toISOString(),
      message: founderMessageDTO(report.message),
    })),
    members,
  }
}

export async function moderateFounderReport(input: {
  reportId: string
  action: 'HIDE' | 'RESOLVE'
  adminUserId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const report = await tx.founderMessageReport.findUnique({
      where: { id: input.reportId },
      select: { id: true, messageId: true, resolvedAt: true },
    })
    if (!report) throw new FounderEnrollmentError('Report not found.', 404)
    if (report.resolvedAt) {
      throw new FounderEnrollmentError('That report is already resolved.', 409)
    }
    if (input.action === 'HIDE') {
      await tx.founderMessage.update({
        where: { id: report.messageId },
        data: { hiddenAt: new Date(), hiddenByUserId: input.adminUserId },
      })
    }
    await tx.founderMessageReport.update({
      where: { id: report.id },
      data: { resolvedAt: new Date() },
    })
  })
}

export async function enrollFoundingProfessional(input: {
  email: string
  specialty: FounderSpecialty
  role?: FounderMemberRole
}): Promise<string> {
  const email = normalizeFounderEnrollmentEmail(input.email) // pii-plaintext-read-ok: value immediately crosses into the founder privacy boundary
  if (!email) throw new FounderEnrollmentError('Enter a valid email.', 400)

  return prisma.$transaction(async (tx) => {
    const account = await findFounderEnrollmentAccountByEmail(email, tx)
    if (!account?.professionalId) {
      throw new FounderEnrollmentError('No professional account matches that email.', 404)
    }

    const existing = await tx.founderMember.findUnique({
      where: { userId: account.userId },
      select: { id: true },
    })
    if (existing) throw new FounderEnrollmentError('That account is already enrolled.', 409)

    const seat = await tx.founderProgram.updateMany({
      where: { id: FOUNDER_PROGRAM_ID, proSeatsUsed: { lt: FOUNDER_PRO_LIMIT } },
      data: { proSeatsUsed: { increment: 1 } },
    })
    if (seat.count !== 1) {
      throw new FounderEnrollmentError('All 100 founding professional seats are filled.', 409)
    }

    const member = await tx.founderMember.create({
      data: {
        userId: account.userId,
        audience: FounderAudience.PRO,
        role: input.role ?? FounderMemberRole.MEMBER,
        status: FounderMemberStatus.ACTIVE,
        specialty: input.specialty,
        professionalId: account.professionalId,
      },
      select: { id: true },
    })
    return member.id
  })
}

export async function enrollFoundingClient(input: {
  email: string
  sponsorEmail: string
}): Promise<{ memberId: string; clientSlot: number }> {
  const email = normalizeFounderEnrollmentEmail(input.email) // pii-plaintext-read-ok: value immediately crosses into the founder privacy boundary
  const sponsorEmail = normalizeFounderEnrollmentEmail(input.sponsorEmail) // pii-plaintext-read-ok: value immediately crosses into the founder privacy boundary
  if (!email || !sponsorEmail) {
    throw new FounderEnrollmentError('Enter valid client and sponsor emails.', 400)
  }

  return prisma.$transaction(async (tx) => {
    const [account, sponsorAccount] = await Promise.all([
      findFounderEnrollmentAccountByEmail(email, tx),
      findFounderEnrollmentAccountByEmail(sponsorEmail, tx),
    ])
    if (!account?.clientId) {
      throw new FounderEnrollmentError('No client account matches that email.', 404)
    }
    if (!sponsorAccount?.professionalId) {
      throw new FounderEnrollmentError('No sponsor professional matches that email.', 404)
    }

    const sponsor = await tx.founderMember.findFirst({
      where: {
        professionalId: sponsorAccount.professionalId,
        audience: FounderAudience.PRO,
        status: FounderMemberStatus.ACTIVE,
      },
      select: { id: true },
    })
    if (!sponsor) {
      throw new FounderEnrollmentError('The sponsor must be an active founding professional.', 409)
    }

    const existing = await tx.founderMember.findUnique({
      where: { userId: account.userId },
      select: { id: true },
    })
    if (existing) throw new FounderEnrollmentError('That client is already enrolled.', 409)

    const connected = await tx.clientProfile.findFirst({
      where: {
        id: account.clientId,
        OR: [
          { createdByProfessionalId: sponsorAccount.professionalId },
          { bookings: { some: { professionalId: sponsorAccount.professionalId } } },
        ],
      },
      select: { id: true },
    })
    if (!connected) {
      throw new FounderEnrollmentError(
        'This client must already be connected to the sponsoring professional.',
        409,
      )
    }

    const occupied = await tx.founderMember.findMany({
      where: { sponsorProfessionalId: sponsorAccount.professionalId },
      select: { clientSlot: true },
    })
    const occupiedSlots = new Set(occupied.map((member) => member.clientSlot))
    const clientSlot = [1, 2, 3].find((slot) => !occupiedSlots.has(slot))
    if (!clientSlot) {
      throw new FounderEnrollmentError('This professional already has three founding clients.', 409)
    }

    const member = await tx.founderMember.create({
      data: {
        userId: account.userId,
        audience: FounderAudience.CLIENT,
        clientId: account.clientId,
        sponsorProfessionalId: sponsorAccount.professionalId,
        clientSlot,
      },
      select: { id: true },
    })
    return { memberId: member.id, clientSlot }
  })
}
