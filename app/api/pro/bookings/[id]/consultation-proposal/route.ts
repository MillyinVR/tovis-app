// app/api/pro/bookings/[id]/consultation-proposal/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { BookingStatus, ConsultationApprovalStatus, SessionStep } from '@prisma/client'
import { transitionSessionStepTx } from '@/lib/booking/transitions'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const NOTES_MAX = 2000

function moneyStringToCents(raw: string): number | null {
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null
  const m = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!m) return null

  const whole = m[1] || '0'
  let frac = (m[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'

  const cents = Number(whole) * 100 + Number(frac || '0')
  if (!Number.isFinite(cents) || cents < 0) return null
  return cents
}

function parseMoneyToCents(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.round(v * 100)
  }
  if (typeof v === 'string') return moneyStringToCents(v)
  const s = (v as any)?.toString?.()
  return typeof s === 'string' ? moneyStringToCents(s) : null
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

function parseProposedServicesJson(v: unknown): any | null {
  if (v == null) return null
  if (typeof v === 'object') return v
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    try {
      const parsed = JSON.parse(s)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

type ProposedServiceRef = { serviceId?: unknown; offeringId?: unknown }

function extractServiceRefsFromProposedJson(v: any): Array<{ serviceId: string | null; offeringId: string | null }> {
  const out: Array<{ serviceId: string | null; offeringId: string | null }> = []

  const visit = (node: any) => {
    if (!node) return
    if (Array.isArray(node)) return node.forEach(visit)
    if (typeof node !== 'object') return

    const maybe = node as ProposedServiceRef
    const serviceId = typeof maybe.serviceId === 'string' && maybe.serviceId.trim() ? maybe.serviceId.trim() : null
    const offeringId = typeof maybe.offeringId === 'string' && maybe.offeringId.trim() ? maybe.offeringId.trim() : null

    if (serviceId || offeringId) out.push({ serviceId, offeringId })
    Object.keys(node).forEach((k) => visit((node as any)[k]))
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
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
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

    const proposedTotalMoney = centsToMoneyString(proposedCents)

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

      if (booking.status === BookingStatus.CANCELLED) return { ok: false as const, status: 409, error: 'This booking is cancelled.' }
      if (booking.status === BookingStatus.COMPLETED || booking.finishedAt)
        return { ok: false as const, status: 409, error: 'This booking is finalized.' }

      // Your intentional rule: client present
      if (!booking.startedAt) return { ok: false as const, status: 409, error: 'Start the appointment before sending a consultation proposal.' }

      if (!canProSendProposal(booking.sessionStep ?? null)) {
        return { ok: false as const, status: 409, error: 'Booking is not in a consultation stage.' }
      }

      // Validate proposal references are from this pro's active offerings
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

      const allowedOfferingIds = new Set(offerings.map((o) => String(o.id)))
      const allowedServiceIds = new Set(offerings.map((o) => String(o.serviceId)))

      for (const r of refs) {
        if (r.offeringId && !allowedOfferingIds.has(r.offeringId)) {
          return { ok: false as const, status: 400, error: 'Proposal includes an offering that is not active for this pro.' }
        }
        if (r.serviceId && !allowedServiceIds.has(r.serviceId)) {
          return { ok: false as const, status: 400, error: 'Proposal includes a service that is not active for this pro.' }
        }
      }

      // Upsert approval
      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          clientId: booking.clientId,
          proId: booking.professionalId,
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson: proposedServicesJson as any,
          proposedTotal: proposedTotalMoney as any,
          notes,
          approvedAt: null,
          rejectedAt: null,
        } as any,
        update: {
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson: proposedServicesJson as any,
          proposedTotal: proposedTotalMoney as any,
          notes,
          approvedAt: null,
          rejectedAt: null,
        } as any,
        select: { id: true, status: true, proposedTotal: true, updatedAt: true },
      })

      // ✅ Canonical step transition (no direct booking.update here)
      const stepRes = await transitionSessionStepTx(tx, {
        bookingId: booking.id,
        proId,
        nextStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      })

      if (!stepRes.ok) {
        // keep transaction atomic: if step can't change, proposal shouldn't be stored either
        return { ok: false as const, status: stepRes.status, error: stepRes.error, forcedStep: stepRes.forcedStep }
      }

      // Best-effort notify client
      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: 'BOOKING' as any,
            title: 'Consultation proposal ready',
            body: 'Your professional sent an updated service total for approval.',
            bookingId: booking.id,
            dedupeKey: `CONSULTATION_PROPOSED:${booking.id}`,
          } as any,
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

    if (!txResult.ok) return jsonFail(txResult.status, txResult.error, txResult.forcedStep ? { forcedStep: txResult.forcedStep } : undefined)

    return jsonOk(
      {
        approval: txResult.approval,
        sessionStep: txResult.sessionStep,
        proposedCents: txResult.proposedCents,
      },
      200,
    )
  } catch (e: any) {
    console.error('POST /api/pro/bookings/[id]/consultation-proposal error', e)
    return jsonFail(500, 'Internal server error')
  }
}