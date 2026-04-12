import {
  ConsultationApprovalProofMethod,
  ConsultationDecision,
  ContactMethod,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requireNonEmptyString(label: string, value: string): string {
  const normalized = normalizeTrimmed(value)
  if (!normalized) {
    throw new Error(`${label} is required.`)
  }
  return normalized
}

function toNullableJsonCreateInput(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

function resolveActedAt(actedAt?: Date | null): Date | undefined {
  if (actedAt == null) return undefined
  if (!(actedAt instanceof Date) || Number.isNaN(actedAt.getTime())) {
    throw new Error('actedAt must be a valid Date when provided.')
  }
  return actedAt
}

export const CONSULTATION_APPROVAL_PROOF_SELECT = {
  id: true,
  consultationApprovalId: true,
  bookingId: true,
  clientId: true,
  professionalId: true,
  decision: true,
  method: true,
  actedAt: true,
  recordedByUserId: true,
  clientActionTokenId: true,
  contactMethod: true,
  destinationSnapshot: true,
  ipAddress: true,
  userAgent: true,
  contextJson: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ConsultationApprovalProofSelect

export type ConsultationApprovalProofRecord =
  Prisma.ConsultationApprovalProofGetPayload<{
    select: typeof CONSULTATION_APPROVAL_PROOF_SELECT
  }>

export type CreateConsultationApprovalProofArgs = {
  consultationApprovalId: string
  bookingId: string
  clientId: string
  professionalId: string
  decision: ConsultationDecision
  method: ConsultationApprovalProofMethod
  recordedByUserId?: string | null
  clientActionTokenId?: string | null
  contactMethod?: ContactMethod | null
  destinationSnapshot?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  contextJson?: Prisma.InputJsonValue | null
  actedAt?: Date | null
  tx?: Prisma.TransactionClient
}

export async function createConsultationApprovalProof(
  args: CreateConsultationApprovalProofArgs,
): Promise<ConsultationApprovalProofRecord> {
  const db = getDb(args.tx)

  const consultationApprovalId = requireNonEmptyString(
    'consultationApprovalId',
    args.consultationApprovalId,
  )
  const bookingId = requireNonEmptyString('bookingId', args.bookingId)
  const clientId = requireNonEmptyString('clientId', args.clientId)
  const professionalId = requireNonEmptyString(
    'professionalId',
    args.professionalId,
  )

  const recordedByUserId = normalizeTrimmed(args.recordedByUserId)
  const clientActionTokenId = normalizeTrimmed(args.clientActionTokenId)
  const destinationSnapshot = normalizeTrimmed(args.destinationSnapshot)
  const ipAddress = normalizeTrimmed(args.ipAddress)
  const userAgent = normalizeTrimmed(args.userAgent)
  const actedAt = resolveActedAt(args.actedAt)

  return db.consultationApprovalProof.create({
    data: {
      consultationApprovalId,
      bookingId,
      clientId,
      professionalId,
      decision: args.decision,
      method: args.method,
      recordedByUserId,
      clientActionTokenId,
      contactMethod: args.contactMethod ?? null,
      destinationSnapshot,
      ipAddress,
      userAgent,
      contextJson: toNullableJsonCreateInput(args.contextJson),
      actedAt,
    },
    select: CONSULTATION_APPROVAL_PROOF_SELECT,
  })
}

export type ConsultationApprovalProofSnapshot = {
  decision: ConsultationDecision
  method: ConsultationApprovalProofMethod
  actedAt: string
  recordedByUserId: string | null
  clientActionTokenId: string | null
  contactMethod: ContactMethod | null
  destinationSnapshot: string | null
}

export function buildConsultationApprovalProofSnapshot(
  proof: Pick<
    ConsultationApprovalProofRecord,
    | 'decision'
    | 'method'
    | 'actedAt'
    | 'recordedByUserId'
    | 'clientActionTokenId'
    | 'contactMethod'
    | 'destinationSnapshot'
  >,
): ConsultationApprovalProofSnapshot {
  return {
    decision: proof.decision,
    method: proof.method,
    actedAt: proof.actedAt.toISOString(),
    recordedByUserId: proof.recordedByUserId ?? null,
    clientActionTokenId: proof.clientActionTokenId ?? null,
    contactMethod: proof.contactMethod ?? null,
    destinationSnapshot: proof.destinationSnapshot ?? null,
  }
}