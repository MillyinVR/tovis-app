// app/api/pro/bookings/[id]/consultation-proposal/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  BookingStatus,
  ConsultationApprovalStatus,
  SessionStep,
  ClientNotificationType,
  Prisma,
} from '@prisma/client'
import { transitionSessionStepTx } from '@/lib/booking/transitions'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const NOTES_MAX = 2000

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

function parseMoneyToCents(v: unknown): number | null {
  if (v == null) return null

  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.round(v * 100)
  }

  if (typeof v !== 'string') return null
  const cleaned = v.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null

  const m = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!m) return null

  const whole = m[1] || '0'
  let frac = (m[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'

  const cents = Number(whole) * 100 + Number(frac)
  if (!Number.isFinite(cents) || cents < 0) return null
  return cents
}

function centsToDecimalDollars(cents: number): Prisma.Decimal {
  // Decimal dollars, e.g. 1234 cents => 12.34
  return new Prisma.Decimal(cents).div(100)
}

function parseProposedServicesJson(v: unknown): Prisma.InputJsonValue | null {
  if (v == null) return null

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    try {
      const parsed: unknown = JSON.parse(s)
      // Prisma JSON can be object/array/primitive — but we require "object-ish" for proposals
      if (parsed && typeof parsed === 'object') return parsed as Prisma.InputJsonValue
      return null
    } catch {
      return null
    }
  }

  if (v && typeof v === 'object') {
    return v as Prisma.InputJsonValue
  }

  return null
}

type ProposedServiceRef = { serviceId?: unknown; offeringId?: unknown }

function extractServiceRefsFromProposedJson(
  v: unknown,
): Array<{ serviceId: string | null; offeringId: string | null }> {
  const out: Array<{ serviceId: string | null; offeringId: string | null }> = []

  const visit = (node: unknown) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>

    const maybe = obj as ProposedServiceRef
    const serviceId = isNonEmptyString(maybe.serviceId) ? maybe.serviceId.trim() : null
    const offeringId = isNonEmptyString(maybe.offeringId) ? maybe.offeringId.trim() : null

    if (serviceId || offeringId) out.push({ serviceId, offeringId })

    for (const k of Object.keys(obj)) visit(obj[k])
  }

  visit(v)
  return out
}

function canProSendProposal(step: SessionStep | null) {
  return step === SessionStep.CONSULTATION || step === SessionStep.CONSULTATION_PENDING_CLIENT
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as {
      proposedServicesJson?: unknown
      proposedTotal?: unknown
      notes?: unknown
    }

    const proposedServicesJson = parseProposedServicesJson(body?.proposedServicesJson)
    if (!proposedServicesJson) return jsonFail(400, 'Missing proposed services.')

    const proposedCents = parseMoneyToCents(body?.proposedTotal)
    if (proposedCents == null) return jsonFail(400, 'Enter a valid total.')

    const notesRaw = pickString(body?.notes)
    const notes = notesRaw ? notesRaw.slice(0, NOTES_MAX) : null

    const proposedTotal = centsToDecimalDollars(proposedCents)

    const txResult = await prisma.$transaction(async (tx) => {
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
        },
      })

      if (!booking) return { ok: false as const, status: 404, error: 'Booking not found.' }
      if (booking.professionalId !== proId) return { ok: false as const, status: 403, error: 'Forbidden.' }

      if (booking.status === BookingStatus.CANCELLED)
        return { ok: false as const, status: 409, error: 'This booking is cancelled.' }
      if (booking.status === BookingStatus.COMPLETED || booking.finishedAt)
        return { ok: false as const, status: 409, error: 'This booking is finalized.' }

      if (!booking.startedAt) {
        return {
          ok: false as const,
          status: 409,
          error: 'Start the appointment before sending a consultation proposal.',
        }
      }

      if (!canProSendProposal(booking.sessionStep ?? null)) {
        return { ok: false as const, status: 409, error: 'Booking is not in a consultation stage.' }
      }

      // Validate references exist in this pro's active offerings
      const refs = extractServiceRefsFromProposedJson(proposedServicesJson)
      if (!refs.length) {
        return {
          ok: false as const,
          status: 400,
          error: 'Proposal must include serviceId (and ideally offeringId) for each line item.',
        }
      }

      const offerings = await tx.professionalServiceOffering.findMany({
        where: { professionalId: proId, isActive: true },
        select: { id: true, serviceId: true },
        take: 1000,
      })

      const allowedOfferingIds = new Set(offerings.map((o) => o.id))
      const allowedServiceIds = new Set(offerings.map((o) => o.serviceId))

      for (const r of refs) {
        if (r.offeringId && !allowedOfferingIds.has(r.offeringId)) {
          return {
            ok: false as const,
            status: 400,
            error: 'Proposal includes an offering that is not active for this pro.',
          }
        }
        if (r.serviceId && !allowedServiceIds.has(r.serviceId)) {
          return {
            ok: false as const,
            status: 400,
            error: 'Proposal includes a service that is not active for this pro.',
          }
        }
      }

      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          clientId: booking.clientId,
          proId: booking.professionalId,
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson,
          proposedTotal,
          notes,
          approvedAt: null,
          rejectedAt: null,
        },
        update: {
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson,
          proposedTotal,
          notes,
          approvedAt: null,
          rejectedAt: null,
        },
        select: { id: true, status: true, proposedTotal: true, updatedAt: true },
      })

      const stepRes = await transitionSessionStepTx(tx, {
        bookingId: booking.id,
        proId,
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      })

      if (!stepRes.ok) {
        return {
          ok: false as const,
          status: stepRes.status,
          error: stepRes.error,
          forcedStep: stepRes.forcedStep,
        }
      }

      // Best-effort notify client
      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: ClientNotificationType.BOOKING,
            title: 'Consultation proposal ready',
            body: 'Your professional sent an updated service total for approval.',
            bookingId: booking.id,
            dedupeKey: `CONSULTATION_PROPOSED:${booking.id}`,
          },
        })
      } catch (e) {
        console.error('Client notification failed (consultation proposal):', e)
      }

      return {
        ok: true as const,
        approval,
        sessionStep: stepRes.booking.sessionStep,
        proposedCents,
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
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/consultation-proposal error', e)
    return jsonFail(500, 'Internal server error')
  }
}