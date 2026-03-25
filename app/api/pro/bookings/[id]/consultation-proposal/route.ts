// app/api/pro/bookings/[id]/consultation-proposal/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  BookingCloseoutAuditAction,
  BookingServiceItemType,
  BookingStatus,
  ClientNotificationType,
  ConsultationApprovalStatus,
  Prisma,
  SessionStep,
} from '@prisma/client'
import { transitionSessionStepInTransaction } from '@/lib/booking/writeBoundary'
import {
  areAuditValuesEqual,
  createBookingCloseoutAuditLog,
} from '@/lib/booking/closeoutAudit'
export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const NOTES_MAX = 2000
const LINE_ITEM_NOTES_MAX = 1000
const MAX_LINE_ITEMS = 100

type ParsedProposalItem = {
  bookingServiceItemId: string | null
  offeringId: string | null
  serviceId: string
  itemType: BookingServiceItemType
  label: string
  categoryName: string | null
  priceText: string
  priceCents: number
  durationMinutes: number
  notes: string | null
  sortOrder: number
  source: 'BOOKING' | 'PROPOSAL'
}

type ParsedProposalPayload = {
  items: ParsedProposalItem[]
  proposedServicesJson: Prisma.InputJsonValue
}

type TxFail = {
  ok: false
  status: number
  error: string
  forcedStep?: SessionStep
}

type TxOk = {
  ok: true
  approval: {
    id: string
    status: ConsultationApprovalStatus
    proposedTotal: Prisma.Decimal | null
    updatedAt: Date
  }
  sessionStep: SessionStep
  proposedCents: number
  meta: {
    mutated: boolean
    noOp: boolean
  }
}

type TxResult = TxFail | TxOk

function parseMoneyToCents(v: unknown): number | null {
  if (v == null) return null

  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.round(v * 100)
  }

  if (typeof v !== 'string') return null

  const cleaned = v.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null

  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned)
  if (!m) return null

  const whole = m[1] ?? '0'
  let frac = m[2] ?? ''
  while (frac.length < 2) frac += '0'

  const cents = Number(whole) * 100 + Number(frac)
  if (!Number.isFinite(cents) || cents < 0) return null
  return cents
}

function centsToDecimalDollars(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100)
}

function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const whole = Math.trunc(n)
  return whole > 0 ? whole : null
}

function parseSortOrder(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const whole = Math.trunc(n)
  return whole >= 0 ? whole : fallback
}

function parseItemType(value: unknown): BookingServiceItemType | null {
  if (value === BookingServiceItemType.BASE || value === 'BASE') {
    return BookingServiceItemType.BASE
  }
  if (value === BookingServiceItemType.ADD_ON || value === 'ADD_ON') {
    return BookingServiceItemType.ADD_ON
  }
  return null
}

function normalizeOptionalNotes(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function buildProposalJson(items: ParsedProposalItem[]): Prisma.InputJsonValue {
  return {
    currency: 'USD',
    items: items.map((item) => ({
      bookingServiceItemId: item.bookingServiceItemId,
      offeringId: item.offeringId,
      serviceId: item.serviceId,
      itemType: item.itemType,
      label: item.label,
      categoryName: item.categoryName,
      price: item.priceText,
      durationMinutes: item.durationMinutes,
      notes: item.notes,
      sortOrder: item.sortOrder,
      source: item.source,
    })),
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function normalizeDecimalText(value: Prisma.Decimal | null | undefined): string | null {
  return value ? value.toFixed(2) : null
}

function readHeaderValue(req: Request, name: string): string | null {
  const value = req.headers.get(name)
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildConsultationProposalAuditSnapshot(args: {
  status: ConsultationApprovalStatus | null | undefined
  proposedServicesJson: unknown
  proposedTotal: Prisma.Decimal | null | undefined
  notes: string | null | undefined
  sessionStep: SessionStep | null | undefined
}) {
  return {
    status: args.status ?? null,
    proposedServicesJson: stableJson(args.proposedServicesJson),
    proposedTotal: normalizeDecimalText(args.proposedTotal),
    notes: args.notes ?? null,
    sessionStep: args.sessionStep ?? SessionStep.NONE,
  }
}

function parseProposalPayload(raw: unknown): ParsedProposalPayload | null {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.items)) return null
  if (raw.items.length < 1 || raw.items.length > MAX_LINE_ITEMS) return null

  const items: ParsedProposalItem[] = []

  for (let index = 0; index < raw.items.length; index += 1) {
    const entry = raw.items[index]
    if (!isRecord(entry)) return null

    const serviceId = pickString(entry.serviceId)
    if (!serviceId) return null

    const itemType = parseItemType(entry.itemType)
    if (!itemType) return null

    const offeringId = pickString(entry.offeringId)
    const bookingServiceItemId = pickString(entry.bookingServiceItemId)

    if (itemType === BookingServiceItemType.BASE && !offeringId) {
      return null
    }

    const label = pickString(entry.label) ?? 'Service'
    const categoryName = pickString(entry.categoryName) ?? null

    const priceCents = parseMoneyToCents(entry.price)
    if (priceCents == null || priceCents <= 0) return null

    const durationMinutes = parsePositiveInt(entry.durationMinutes)
    if (durationMinutes == null) return null

    const sourceRaw = pickString(entry.source)
    const source =
      sourceRaw === 'BOOKING' || sourceRaw === 'PROPOSAL'
        ? sourceRaw
        : 'PROPOSAL'

    items.push({
      bookingServiceItemId: bookingServiceItemId ?? null,
      offeringId: offeringId ?? null,
      serviceId,
      itemType,
      label: label.slice(0, 200),
      categoryName: categoryName ? categoryName.slice(0, 120) : null,
      priceText: (priceCents / 100).toFixed(2),
      priceCents,
      durationMinutes,
      notes: normalizeOptionalNotes(entry.notes, LINE_ITEM_NOTES_MAX),
      sortOrder: parseSortOrder(entry.sortOrder, index),
      source,
    })
  }

  items.sort((a, b) => a.sortOrder - b.sortOrder)

  const baseCount = items.filter(
    (item) => item.itemType === BookingServiceItemType.BASE,
  ).length

  if (baseCount !== 1) return null

  return {
    items,
    proposedServicesJson: buildProposalJson(items),
  }
}

function canProSendProposal(step: SessionStep | null): boolean {
  return (
    step === SessionStep.CONSULTATION ||
    step === SessionStep.CONSULTATION_PENDING_CLIENT
  )
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const requestId = readHeaderValue(req, 'x-request-id')
    const idempotencyKey = readHeaderValue(req, 'idempotency-key')

    const body: unknown = await req.json().catch(() => null)
    if (!isRecord(body)) {
      return jsonFail(400, 'Invalid request body.')
    }

    const proposal = parseProposalPayload(body.proposedServicesJson)
    if (!proposal) {
      return jsonFail(
        400,
        'Invalid proposed services. Include exactly one base service, and each line item needs service, type, price, and duration.',
      )
    }

    const proposedCents = parseMoneyToCents(body.proposedTotal)
    if (proposedCents == null || proposedCents <= 0) {
      return jsonFail(400, 'Enter a valid total.')
    }

    const computedCents = proposal.items.reduce(
      (sum, item) => sum + item.priceCents,
      0,
    )

    if (computedCents !== proposedCents) {
      return jsonFail(400, 'Proposal total must equal the sum of the line items.')
    }

    const notesRaw = pickString(body.notes)
    const notes = notesRaw ? notesRaw.slice(0, NOTES_MAX) : null
    const proposedTotal = centsToDecimalDollars(proposedCents)

    const txResult: TxResult = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          professionalId: true,
          clientId: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          sessionStep: true,
          serviceItems: {
            select: {
              id: true,
              serviceId: true,
              offeringId: true,
              itemType: true,
            },
            take: 500,
          },
          consultationApproval: {
            select: {
              id: true,
              status: true,
              proposedServicesJson: true,
              proposedTotal: true,
              notes: true,
              updatedAt: true,
            },
          },
        },
      })

      if (!booking) {
        return { ok: false, status: 404, error: 'Booking not found.' }
      }

      if (booking.professionalId !== proId) {
        return { ok: false, status: 403, error: 'Forbidden.' }
      }

      if (booking.status === BookingStatus.CANCELLED) {
        return { ok: false, status: 409, error: 'This booking is cancelled.' }
      }

      if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
        return { ok: false, status: 409, error: 'This booking is finalized.' }
      }

      if (!booking.startedAt) {
        return {
          ok: false,
          status: 409,
          error: 'Start the appointment before sending a consultation proposal.',
        }
      }

      if (!canProSendProposal(booking.sessionStep ?? null)) {
        return {
          ok: false,
          status: 409,
          error: 'Booking is not in a consultation stage.',
        }
      }

      const activeOfferings = await tx.professionalServiceOffering.findMany({
        where: {
          professionalId: proId,
          isActive: true,
          service: { isActive: true },
        },
        select: {
          id: true,
          serviceId: true,
          addOns: {
            where: {
              isActive: true,
              addOnService: { isActive: true, isAddOnEligible: true },
            },
            select: {
              addOnServiceId: true,
            },
          },
        },
        take: 1000,
      })

      const baseOfferingById = new Map(
        activeOfferings.map((offering) => [offering.id, offering.serviceId]),
      )

      const allowedAddOnServiceIds = new Set(
        activeOfferings.flatMap((offering) =>
          offering.addOns.map((addOn) => addOn.addOnServiceId),
        ),
      )

      const bookingItemIds = new Set(booking.serviceItems.map((item) => item.id))

      for (const item of proposal.items) {
        if (
          item.bookingServiceItemId &&
          !bookingItemIds.has(item.bookingServiceItemId)
        ) {
          return {
            ok: false,
            status: 400,
            error:
              'Proposal references a booking service item that does not belong to this booking.',
          }
        }

        if (item.itemType === BookingServiceItemType.BASE) {
          if (!item.offeringId) {
            return {
              ok: false,
              status: 400,
              error: 'Base services must include an offeringId.',
            }
          }

          const expectedServiceId = baseOfferingById.get(item.offeringId)
          if (!expectedServiceId) {
            return {
              ok: false,
              status: 400,
              error: 'Proposal includes an offering that is not active for this pro.',
            }
          }

          if (expectedServiceId !== item.serviceId) {
            return {
              ok: false,
              status: 400,
              error: 'Base service does not match the selected offering.',
            }
          }
        } else {
          if (!allowedAddOnServiceIds.has(item.serviceId)) {
            return {
              ok: false,
              status: 400,
              error:
                'Proposal includes an add-on service that is not active for this pro.',
            }
          }

          if (item.offeringId && !baseOfferingById.has(item.offeringId)) {
            return {
              ok: false,
              status: 400,
              error: 'Proposal includes an invalid parent offering reference on an add-on.',
            }
          }
        }
      }

      const existingApproval = booking.consultationApproval
      const sameProposal =
        existingApproval?.status === ConsultationApprovalStatus.PENDING &&
        stableJson(existingApproval.proposedServicesJson) ===
          stableJson(proposal.proposedServicesJson) &&
        normalizeDecimalText(existingApproval.proposedTotal) ===
          normalizeDecimalText(proposedTotal) &&
        (existingApproval.notes ?? null) === notes

      if (
        sameProposal &&
        (booking.sessionStep ?? SessionStep.NONE) ===
          SessionStep.CONSULTATION_PENDING_CLIENT
      ) {
        return {
          ok: true,
          approval: {
            id: existingApproval.id,
            status: existingApproval.status,
            proposedTotal: existingApproval.proposedTotal,
            updatedAt: existingApproval.updatedAt,
          },
          sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
          proposedCents,
          meta: {
            mutated: false,
            noOp: true,
          },
        }
      }

      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          clientId: booking.clientId,
          proId: booking.professionalId,
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson: proposal.proposedServicesJson,
          proposedTotal,
          notes,
          approvedAt: null,
          rejectedAt: null,
        },
        update: {
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson: proposal.proposedServicesJson,
          proposedTotal,
          notes,
          approvedAt: null,
          rejectedAt: null,
        },
        select: {
          id: true,
          status: true,
          proposedTotal: true,
          updatedAt: true,
        },
      })

      const stepRes = await transitionSessionStepInTransaction(tx, {
        bookingId: booking.id,
        professionalId: proId,
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      })

      if (!stepRes.ok) {
        return {
          ok: false,
          status: stepRes.status,
          error: stepRes.error,
          forcedStep: stepRes.forcedStep,
        }
      }

      await tx.clientNotification.upsert({
        where: {
          dedupeKey: `CONSULTATION_PROPOSED:${booking.id}`,
        },
        create: {
          clientId: booking.clientId,
          type: ClientNotificationType.BOOKING,
          title: 'Consultation proposal ready',
          body: 'Your professional sent an updated service total for approval.',
          bookingId: booking.id,
          dedupeKey: `CONSULTATION_PROPOSED:${booking.id}`,
        },
        update: {
          clientId: booking.clientId,
          type: ClientNotificationType.BOOKING,
          title: 'Consultation proposal ready',
          body: 'Your professional sent an updated service total for approval.',
          bookingId: booking.id,
        },
      })

            const oldProposalState = buildConsultationProposalAuditSnapshot({
        status: existingApproval?.status,
        proposedServicesJson: existingApproval?.proposedServicesJson ?? null,
        proposedTotal: existingApproval?.proposedTotal,
        notes: existingApproval?.notes ?? null,
        sessionStep: booking.sessionStep,
      })

      const newProposalState = buildConsultationProposalAuditSnapshot({
        status: approval.status,
        proposedServicesJson: proposal.proposedServicesJson,
        proposedTotal: approval.proposedTotal,
        notes,
        sessionStep: stepRes.booking.sessionStep,
      })

      if (!areAuditValuesEqual(oldProposalState, newProposalState)) {
        await createBookingCloseoutAuditLog({
          tx,
          bookingId: booking.id,
          professionalId: proId,
          action: BookingCloseoutAuditAction.CONSULTATION_PROPOSAL_SENT,
          route: 'app/api/pro/bookings/[id]/consultation-proposal/route.ts',
          requestId,
          idempotencyKey,
          oldValue: oldProposalState,
          newValue: newProposalState,
          metadata: {
            proposalItemCount: proposal.items.length,
            previousStep: booking.sessionStep ?? SessionStep.NONE,
            nextStep: stepRes.booking.sessionStep,
            replacedExistingProposal: Boolean(existingApproval?.id),
          },
        })
      }

      return {
        ok: true,
        approval,
        sessionStep: stepRes.booking.sessionStep,
        proposedCents,
        meta: {
          mutated: true,
          noOp: false,
        },
      }
    })

    if (!txResult.ok) {
      return jsonFail(
        txResult.status,
        txResult.error,
        txResult.forcedStep ? { forcedStep: txResult.forcedStep } : undefined,
      )
    }

    return jsonOk(
      {
        approval: txResult.approval,
        sessionStep: txResult.sessionStep,
        proposedCents: txResult.proposedCents,
        meta: txResult.meta,
      },
      200,
    )
  } catch (err: unknown) {
    console.error('POST /api/pro/bookings/[id]/consultation-proposal error', err)
    return jsonFail(500, 'Internal server error')
  }
}