// app/api/v1/pro/bookings/[id]/consultation-proposal/route.ts
import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  BookingCloseoutAuditAction,
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  ContactMethod,
  MediaPhase,
  NotificationEventKey,
  Prisma,
  Role,
  SessionStep,
} from '@prisma/client'
import { transitionSessionStepInTransaction } from '@/lib/booking/writeBoundary'
import {
  areAuditValuesEqual,
  createBookingCloseoutAuditLog,
} from '@/lib/booking/closeoutAudit'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { createConsultationActionDelivery } from '@/lib/clientActions/createConsultationActionDelivery'
import {
  bookingError,
  isBookingError,
} from '@/lib/booking/errors'
import { hasCalendarBlockConflict } from '@/lib/booking/conflictQueries'
import {
  consultationExtensionWindow,
  resolveConsultationMaterialization,
  resolveConsultationScheduleOutlook,
  type ConsultationScheduleOutlook,
} from '@/lib/consultation/proposalSchedule'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { encryptedNoteInput } from '@/lib/security/notesPrivacy'

export const dynamic = 'force-dynamic'

const NOTES_MAX = 2000
const LINE_ITEM_NOTES_MAX = 1000
const MAX_LINE_ITEMS = 100

const OPERATION = 'POST /api/v1/pro/bookings/[id]/consultation-proposal'

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
}

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

/**
 * F12 — what the proposal does to the appointment's end time, returned on every
 * success so the pro learns it from the act of sending rather than from the
 * client bouncing off it later.
 *
 * `endsAt` is a UTC instant and `timeZone` the appointment's zone; when the zone
 * could not be resolved it is null and `outlook` is `NOT_CHECKED`, and a client
 * must not render a wall-clock time it has no zone for.
 */
type ProposalScheduleSummary = {
  endsAt: Date
  durationMinutes: number
  bufferMinutes: number
  timeZone: string | null
  outlook: ConsultationScheduleOutlook
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
  schedule: ProposalScheduleSummary
  meta: {
    mutated: boolean
    noOp: boolean
  }
}

type TxResult = TxFail | TxOk

type ConsultationActionDeliverySummary = {
  attempted: boolean
  queued: boolean
  href: string | null
}

const CONSULTATION_DELIVERY_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  clientId: true,
  clientTimeZoneAtBooking: true,
  locationTimeZone: true,
  professional: { select: professionalPublicDisplayNameSelect },
  client: {
    select: {
      id: true,
      userId: true,
      email: true,
      phone: true,
      preferredContactMethod: true,
      user: {
        select: {
          email: true,
          phone: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type ConsultationDeliveryBookingRecord = Prisma.BookingGetPayload<{
  select: typeof CONSULTATION_DELIVERY_BOOKING_SELECT
}>

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

function normalizeDecimalText(
  value: Prisma.Decimal | null | undefined,
): string | null {
  return value ? value.toFixed(2) : null
}

function readHeaderValue(req: Request, name: string): string | null {
  const value = req.headers.get(name)
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readRequestMeta(req: Request): RequestMeta {
  const requestId =
    readHeaderValue(req, 'x-request-id') ??
    readHeaderValue(req, 'request-id') ??
    null

  const idempotencyKey =
    readHeaderValue(req, 'idempotency-key') ??
    readHeaderValue(req, 'x-idempotency-key') ??
    null

  return { requestId, idempotencyKey }
}

function trimmedString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pickFirstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = trimmedString(value)
    if (normalized) return normalized
  }

  return null
}

function inferPreferredContactMethod(args: {
  email: string | null
  phone: string | null
  existingPreference: ContactMethod | null | undefined
}): ContactMethod | null {
  if (args.existingPreference) return args.existingPreference
  if (args.email && !args.phone) return ContactMethod.EMAIL
  if (args.phone && !args.email) return ContactMethod.SMS
  return null
}

function resolveConsultationRecipientTimeZone(
  booking: ConsultationDeliveryBookingRecord,
): string | null {
  return (
    trimmedString(booking.clientTimeZoneAtBooking) ??
    trimmedString(booking.locationTimeZone) ??
    null
  )
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

  // A booking carries one or more co-equal BASE services (e.g. cut + color);
  // ADD_ON items hang off a base. Require at least one base.
  const baseCount = items.filter(
    (item) => item.itemType === BookingServiceItemType.BASE,
  ).length

  if (baseCount < 1) return null

  return {
    items,
    proposedServicesJson: buildProposalJson(items),
  }
}

function canProSendProposal(step: SessionStep | null): boolean {
  return (
    step === SessionStep.CONSULTATION ||
    step === SessionStep.CONSULTATION_PENDING_CLIENT ||
    // §22 MS1: a pro may re-open the consultation to change the service after
    // approval, but only from a post-consultation step that has captured no
    // photos yet — that pre-capture guard is enforced separately (the step
    // alone isn't sufficient authorization). See isPostConsultationReopenStep.
    isPostConsultationReopenStep(step)
  )
}

// The post-consultation steps from which §22 MS1 allows re-opening the
// consultation to change the service. Gated on "no photos captured yet".
function isPostConsultationReopenStep(step: SessionStep | null): boolean {
  return (
    step === SessionStep.BEFORE_PHOTOS ||
    step === SessionStep.SERVICE_IN_PROGRESS
  )
}

async function maybeQueueConsultationActionDelivery(args: {
  bookingId: string
  professionalId: string
  consultationApprovalId: string
  shouldAttempt: boolean
}): Promise<ConsultationActionDeliverySummary> {
  if (!args.shouldAttempt) {
    return {
      attempted: false,
      queued: false,
      href: null,
    }
  }

  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: CONSULTATION_DELIVERY_BOOKING_SELECT,
  })

  if (!booking || booking.professionalId !== args.professionalId) {
    console.error(
      'POST /api/v1/pro/bookings/[id]/consultation-proposal delivery context lookup failed',
      {
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        consultationApprovalId: args.consultationApprovalId,
      },
    )

    return {
      attempted: true,
      queued: false,
      href: null,
    }
  }

  const recipientEmail = pickFirstNonEmpty(
    booking.client.email,
    booking.client.user?.email ?? null,
  )
  const recipientPhone = pickFirstNonEmpty(
    booking.client.phone,
    booking.client.user?.phone ?? null,
  )

  if (!recipientEmail && !recipientPhone) {
    console.error(
      'POST /api/v1/pro/bookings/[id]/consultation-proposal delivery skipped: no client destination',
      {
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        consultationApprovalId: args.consultationApprovalId,
        clientId: booking.clientId,
      },
    )

    return {
      attempted: true,
      queued: false,
      href: null,
    }
  }

  try {
    const delivery = await createConsultationActionDelivery({
      professionalId: args.professionalId,
      professionalName: formatProfessionalPublicDisplayName(booking.professional),
      clientId: booking.clientId,
      bookingId: booking.id,
      consultationApprovalId: args.consultationApprovalId,
      recipientUserId: booking.client.userId ?? null,
      recipientEmail,
      recipientPhone,
      preferredContactMethod: inferPreferredContactMethod({
        email: recipientEmail,
        phone: recipientPhone,
        existingPreference: booking.client.preferredContactMethod,
      }),
      recipientTimeZone: resolveConsultationRecipientTimeZone(booking),
    })

    return {
      attempted: true,
      queued: true,
      href: delivery.link.href,
    }
  } catch (error: unknown) {
    console.error(
      'POST /api/v1/pro/bookings/[id]/consultation-proposal action delivery enqueue failed',
      {
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        consultationApprovalId: args.consultationApprovalId,
        clientId: booking.clientId,
        error,
      },
    )

    return {
      attempted: true,
      queued: false,
      href: null,
    }
  }
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failStartedRouteIdempotency({
    idempotencyRecordId,
    operation: OPERATION,
  }).catch((failError) => {
    console.error(
      'POST /api/v1/pro/bookings/[id]/consultation-proposal idempotency failure update error:',
      failError,
    )
  })
}

export async function POST(req: Request, ctx: RouteContext) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to send this consultation proposal.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const requestMeta = readRequestMeta(req)

    const body: unknown = await req.json().catch(() => null)
    if (!isRecord(body)) {
      return jsonFail(400, 'Invalid request body.')
    }

    const proposal = parseProposalPayload(body.proposedServicesJson)
    if (!proposal) {
      return jsonFail(
        400,
        'Invalid proposed services. Include at least one base service, and each line item needs service, type, price, and duration.',
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
      return jsonFail(
        400,
        'Proposal total must equal the sum of the line items.',
      )
    }

    const notesRaw = pickString(body.notes)
    const notes = notesRaw ? notesRaw.slice(0, NOTES_MAX) : null
    const proposedTotal = centsToDecimalDollars(proposedCents)

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.CONSULTATION_PROPOSAL_SEND,
      requestLabel: 'consultation proposal',
      requestBody: {
        professionalId,
        actorUserId,
        bookingId,
        proposedServicesJson: proposal.proposedServicesJson,
        proposedTotal: proposedTotal.toFixed(2),
        proposedCents,
        notes,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching consultation proposal request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const idempotencyKey = idempotency.idempotencyKey

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
          // F12 — the columns the propose-time schedule check reads.
          // `locationId` because calendar blocks are location-aware; the rest
          // to place the extension window and judge it against working hours.
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
          locationId: true,
          locationType: true,
          locationTimeZone: true,
          professional: {
            select: { ...professionalPublicDisplayNameSelect, timeZone: true },
          },
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

      // Unify foreign + missing into a single 404 so the API never reveals
      // that another pro's booking exists (matches requireProBooking and the
      // booking write boundary's no-leak contract).
      if (!booking || booking.professionalId !== professionalId) {
        return { ok: false, status: 404, error: 'Booking not found.' }
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
          error:
            'Start the appointment before sending a consultation proposal.',
        }
      }

      if (!canProSendProposal(booking.sessionStep ?? null)) {
        return {
          ok: false,
          status: 409,
          error: 'Booking is not in a consultation stage.',
        }
      }

      // §22 MS1 — pre-capture-only guard. Re-opening the consultation from a
      // post-consultation step (before-photos / service-in-progress) is allowed
      // ONLY while no session photos have been captured: once the pro has shot
      // before/after photos of the agreed service, changing it would desync the
      // record (and the captured-payment case is deferred to MS3). The step
      // guard above lets these steps through; this is the actual authorization.
      if (isPostConsultationReopenStep(booking.sessionStep ?? null)) {
        const capturedPhotos = await tx.mediaAsset.count({
          where: {
            bookingId: booking.id,
            uploadedByRole: Role.PRO,
            phase: { in: [MediaPhase.BEFORE, MediaPhase.AFTER] },
          },
        })

        if (capturedPhotos > 0) {
          return {
            ok: false,
            status: 409,
            error:
              'You can’t change the service once session photos are captured.',
          }
        }
      }

      const activeOfferings = await tx.professionalServiceOffering.findMany({
        where: {
          professionalId,
          isActive: true,
          service: { isActive: true },
        },
        select: {
          id: true,
          serviceId: true,
          addOns: {
            where: {
              isActive: true,
              addOnService: {
                isActive: true,
                isAddOnEligible: true,
              },
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

      const bookingItemIds = new Set(
        booking.serviceItems.map((item) => item.id),
      )

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
              error:
                'Proposal includes an offering that is not active for this pro.',
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
              error:
                'Proposal includes an invalid parent offering reference on an add-on.',
            }
          }
        }
      }

      // ── F12 ──────────────────────────────────────────────────────────────
      // Everything above validates WHAT is being proposed. Nothing until now
      // asked what it does to the CLOCK — the pro could author an end time no
      // check had ever seen, and the client was the one who found out, at
      // approve, on a link that leads nowhere useful.
      //
      // Both of these run BEFORE the first write in this transaction. That
      // matters twice over: a refusal here rolls nothing back (this route
      // returns plain objects from the tx callback, and a `return` COMMITS),
      // and the informational half can never take down a proposal that
      // otherwise succeeded.
      const materialization = await resolveConsultationMaterialization({
        tx,
        professionalId,
        locationType: booking.locationType,
        proposedServicesJson: proposal.proposedServicesJson,
      }).catch((error: unknown) => {
        // The approval rebuilds every line item from the offering catalog and
        // refuses what it cannot rebuild. The route's own validation above is
        // looser — notably it never checks that an offering serves THIS
        // booking's location mode — so this is the first place a
        // salon-only service on a mobile appointment is caught. Before F12 it
        // was caught at approve, as an opaque "Invalid service items." shown
        // to the client.
        if (isBookingError(error) && error.code === 'INVALID_SERVICE_ITEMS') {
          throw bookingError('INVALID_SERVICE_ITEMS', {
            message: `Consultation proposal cannot be materialized. bookingId=${booking.id}`,
            userMessage:
              'One of these services can’t be added to this appointment — it’s no longer active, or it isn’t offered at this appointment’s location. Remove it and send again.',
          })
        }
        throw error
      })

      const extension = consultationExtensionWindow({
        scheduledFor: booking.scheduledFor,
        previousDurationMinutes: booking.totalDurationMinutes,
        bufferMinutes: booking.bufferMinutes,
        materializedDurationMinutes: materialization.computedDurationMinutes,
      })

      // A calendar block is fatal at approve (F2) and never override-gated
      // anywhere in the repo. Sending a proposal that approval is certain to
      // refuse only moves the dead end onto the client, so refuse it here —
      // to the pro, who is the only person who can clear the block. The window
      // and the probe are the approval's own, so this can never be stricter
      // than the gate it is standing in front of.
      if (extension.extendsAppointment) {
        const blocked = await hasCalendarBlockConflict({
          tx,
          professionalId,
          locationId: booking.locationId,
          requestedStart: extension.extensionStart,
          requestedEnd: extension.materializedEnd,
        })

        if (blocked) {
          throw bookingError('TIME_BLOCKED', {
            message: `Consultation proposal extension runs into blocked time. bookingId=${booking.id}`,
            userMessage:
              'These services run past this appointment into time you’ve blocked off. Clear the block or trim the proposal, then send again.',
            // PICK_NEW_SLOT (the catalog default) belongs to the booking flow.
            // The appointment is underway; there is no slot to pick.
            uiAction: 'NONE',
          })
        }
      }

      // Working hours INFORM here, they do not refuse — the reasoning lives at
      // resolveConsultationScheduleOutlook. This never throws.
      const scheduleOutlook = await resolveConsultationScheduleOutlook({
        tx,
        professionalId,
        locationId: booking.locationId,
        bookingLocationTimeZone: booking.locationTimeZone,
        professionalTimeZone: booking.professional?.timeZone ?? null,
        scheduledFor: booking.scheduledFor,
        previousEnd: extension.previousEnd,
        materializedEnd: extension.materializedEnd,
      })

      const schedule: ProposalScheduleSummary = {
        endsAt: extension.materializedEnd,
        durationMinutes: materialization.computedDurationMinutes,
        bufferMinutes: booking.bufferMinutes,
        timeZone: scheduleOutlook.timeZone,
        outlook: scheduleOutlook.outlook,
      }
      // ─────────────────────────────────────────────────────────────────────

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
          schedule,
          meta: {
            mutated: false,
            noOp: true,
          },
        }
      }

      // The step gate runs BEFORE the proposal write, deliberately. Returning
      // from this $transaction callback COMMITS, and this refusal is a return
      // — so anything written above it would survive the 409. With the old
      // order (upsert first) a NO_SHOW or PENDING booking left a committed
      // PENDING proposal behind its refusal, resetting an APPROVED one's
      // status/approvedAt if it existed. The transition's own forced-reset
      // write (PENDING bookings pinned back to CONSULTATION) is the one thing
      // that SHOULD survive this return, exactly as it does for its other
      // callers. The transition does not read the approval row for this step,
      // so running it first cannot change its verdict.
      const stepRes = await transitionSessionStepInTransaction(tx, {
        bookingId: booking.id,
        professionalId,
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
          // Dual-write: plaintext (above) + AEAD envelope during burn-in.
          notesEncrypted: encryptedNoteInput(notes),
          approvedAt: null,
          rejectedAt: null,
        },
        update: {
          status: ConsultationApprovalStatus.PENDING,
          proposedServicesJson: proposal.proposedServicesJson,
          proposedTotal,
          notes,
          notesEncrypted: encryptedNoteInput(notes),
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

      await upsertClientNotification({
        tx,
        clientId: booking.clientId,
        eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
        title: 'Consultation proposal ready',
        // §12 NC1 #10: personalize with the pro; no dollar amount in the notif.
        body: `${formatProfessionalPublicDisplayName(
          booking.professional,
        )} sent an updated proposal for your visit. Approve or decline to continue.`,
        bookingId: booking.id,
        href: `/client/bookings/${booking.id}?step=consult`,
        dedupeKey: `CONSULTATION_PROPOSAL:${booking.id}`,
        data: {
          bookingId: booking.id,
          consultationApprovalId: approval.id,
          reason: 'CONSULTATION_PROPOSAL_READY',
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
          professionalId,
          action: BookingCloseoutAuditAction.CONSULTATION_PROPOSAL_SENT,
          route:
            'app/api/v1/pro/bookings/[id]/consultation-proposal/route.ts',
          requestId: requestMeta.requestId,
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
        schedule,
        meta: {
          mutated: true,
          noOp: false,
        },
      }
    })

    if (!txResult.ok) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(
        txResult.status,
        txResult.error,
        txResult.forcedStep ? { forcedStep: txResult.forcedStep } : undefined,
      )
    }

    const consultationActionDelivery =
      await maybeQueueConsultationActionDelivery({
        bookingId,
        professionalId,
        consultationApprovalId: txResult.approval.id,
        shouldAttempt: txResult.meta.mutated && !txResult.meta.noOp,
      })

    const responseBody = normalizeJsonObjectPayload({
      approval: txResult.approval,
      sessionStep: txResult.sessionStep,
      proposedCents: txResult.proposedCents,
      schedule: txResult.schedule,
      consultationActionDelivery,
      meta: txResult.meta,
    })

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    // The consultation proposal + its client notification have committed —
    // deliver the magic-link email/SMS right away rather than on the next cron.
    kickNotificationDrain()

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(
      'POST /api/v1/pro/bookings/[id]/consultation-proposal error',
      error,
    )
    captureBookingException({
      error,
      route: OPERATION,
    })

    return jsonFail(500, 'Internal server error')
  }
}