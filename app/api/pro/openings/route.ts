// app/api/pro/openings/route.ts
import { prisma } from '@/lib/prisma'
import {
  CreateLastMinuteOpeningError,
  createLastMinuteOpening,
  type CreateLastMinuteOpeningTierInput,
  type CreatedLastMinuteOpening,
} from '@/lib/lastMinute/commands/createLastMinuteOpening'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  OpeningStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

const DEFAULT_HOURS = 48
const MAX_LOOKAHEAD_HOURS = 24 * 14
const DEFAULT_TAKE = 100
const MAX_TAKE = 200
const MAX_NOTE_LENGTH = 500

async function readJsonObject(req: Request): Promise<JsonObject> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function parseIntParam(v: string | null): number | null {
  const s = pickString(v)
  if (!s) return null

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function parseIsoDate(v: unknown): Date | null {
  const s = pickString(typeof v === 'string' ? v : null)
  if (!s) return null

  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseNote(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'Invalid note.' }

  const trimmed = value.trim()
  return {
    ok: true,
    value: trimmed ? trimmed.slice(0, MAX_NOTE_LENGTH) : null,
  }
}

function normalizeLocationType(value: unknown): ServiceLocationType | null {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (s === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (s === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
}

function normalizeOpeningStatus(value: unknown): OpeningStatus | null {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (s === OpeningStatus.ACTIVE) return OpeningStatus.ACTIVE
  if (s === OpeningStatus.BOOKED) return OpeningStatus.BOOKED
  if (s === OpeningStatus.EXPIRED) return OpeningStatus.EXPIRED
  if (s === OpeningStatus.CANCELLED) return OpeningStatus.CANCELLED
  return null
}

function normalizeVisibilityMode(value: unknown): LastMinuteVisibilityMode | null {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (s === LastMinuteVisibilityMode.TARGETED_ONLY) return LastMinuteVisibilityMode.TARGETED_ONLY
  if (s === LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY) return LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY
  if (s === LastMinuteVisibilityMode.PUBLIC_IMMEDIATE) return LastMinuteVisibilityMode.PUBLIC_IMMEDIATE
  return null
}

function normalizeTier(value: unknown): LastMinuteTier | null {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (s === LastMinuteTier.WAITLIST) return LastMinuteTier.WAITLIST
  if (s === LastMinuteTier.REACTIVATION) return LastMinuteTier.REACTIVATION
  if (s === LastMinuteTier.DISCOVERY) return LastMinuteTier.DISCOVERY
  return null
}

function normalizeOfferType(value: unknown): LastMinuteOfferType | null {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (s === LastMinuteOfferType.NONE) return LastMinuteOfferType.NONE
  if (s === LastMinuteOfferType.PERCENT_OFF) return LastMinuteOfferType.PERCENT_OFF
  if (s === LastMinuteOfferType.AMOUNT_OFF) return LastMinuteOfferType.AMOUNT_OFF
  if (s === LastMinuteOfferType.FREE_SERVICE) return LastMinuteOfferType.FREE_SERVICE
  if (s === LastMinuteOfferType.FREE_ADD_ON) return LastMinuteOfferType.FREE_ADD_ON
  return null
}

function parseOfferingIds(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'offeringIds must be an array.' }
  }

  const offeringIds = Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0),
    ),
  )

  if (offeringIds.length === 0) {
    return { ok: false, error: 'Select at least one offering.' }
  }

  return { ok: true, value: offeringIds }
}

function parseTierPlans(
  value: unknown,
): { ok: true; value: CreateLastMinuteOpeningTierInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'tierPlans must be an array.' }
  }

  const plans: CreateLastMinuteOpeningTierInput[] = []

  for (const raw of value) {
    if (!isRecord(raw)) {
      return { ok: false, error: 'Each tier plan must be an object.' }
    }

    const tier = normalizeTier(raw.tier)
    if (!tier) {
      return { ok: false, error: 'Each tier plan must include a valid tier.' }
    }

    const offerTypeRaw = raw.offerType
    const offerType =
      offerTypeRaw === undefined || offerTypeRaw === null
        ? undefined
        : normalizeOfferType(offerTypeRaw)

    if (offerTypeRaw !== undefined && offerTypeRaw !== null && !offerType) {
      return { ok: false, error: `Invalid offerType for ${tier}.` }
    }

    let percentOff: number | null | undefined = undefined
    if (raw.percentOff !== undefined && raw.percentOff !== null && raw.percentOff !== '') {
      const n = Number(raw.percentOff)
      if (!Number.isFinite(n)) {
        return { ok: false, error: `percentOff for ${tier} must be numeric.` }
      }
      percentOff = Math.trunc(n)
    } else if (raw.percentOff === null || raw.percentOff === '') {
      percentOff = null
    }

    let amountOff: string | number | null | undefined = undefined
    if (raw.amountOff !== undefined) {
      if (
        raw.amountOff === null ||
        raw.amountOff === '' ||
        typeof raw.amountOff === 'number' ||
        typeof raw.amountOff === 'string'
      ) {
        amountOff = raw.amountOff as string | number | null
      } else {
        return { ok: false, error: `amountOff for ${tier} must be a string, number, or null.` }
      }
    }

    const freeAddOnServiceId = cleanOptionalString(raw.freeAddOnServiceId)

    plans.push({
      tier,
      offerType,
      percentOff,
      amountOff,
      freeAddOnServiceId,
    })
  }

  return { ok: true, value: plans }
}

const openingSelect = {
  id: true,
  professionalId: true,
  locationType: true,
  locationId: true,
  timeZone: true,
  startAt: true,
  endAt: true,
  status: true,
  visibilityMode: true,
  launchAt: true,
  expiresAt: true,
  publicVisibleFrom: true,
  publicVisibleUntil: true,
  bookedAt: true,
  cancelledAt: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      type: true,
      name: true,
      city: true,
      state: true,
      formattedAddress: true,
      timeZone: true,
      lat: true,
      lng: true,
    },
  },
  services: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      openingId: true,
      serviceId: true,
      offeringId: true,
      sortOrder: true,
      createdAt: true,
      service: {
        select: {
          id: true,
          name: true,
          minPrice: true,
          defaultDurationMinutes: true,
          isAddOnEligible: true,
          addOnGroup: true,
        },
      },
      offering: {
        select: {
          id: true,
          title: true,
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: true,
          salonDurationMinutes: true,
          mobilePriceStartingAt: true,
          mobileDurationMinutes: true,
        },
      },
    },
  },
  tierPlans: {
    orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
    select: {
      id: true,
      openingId: true,
      tier: true,
      scheduledFor: true,
      processedAt: true,
      cancelledAt: true,
      lastError: true,
      offerType: true,
      percentOff: true,
      amountOff: true,
      freeAddOnServiceId: true,
      freeAddOnService: {
        select: {
          id: true,
          name: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  },
  _count: {
    select: {
      recipients: true,
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

type OpeningRow = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingSelect
}>

function decimalToString(value: Prisma.Decimal | null): string | null {
  return value ? value.toString() : null
}

function mapOpeningDto(opening: OpeningRow) {
  return {
    id: opening.id,
    professionalId: opening.professionalId,
    status: opening.status,
    visibilityMode: opening.visibilityMode,
    startAt: opening.startAt.toISOString(),
    endAt: opening.endAt ? opening.endAt.toISOString() : null,
    launchAt: opening.launchAt ? opening.launchAt.toISOString() : null,
    expiresAt: opening.expiresAt ? opening.expiresAt.toISOString() : null,
    publicVisibleFrom: opening.publicVisibleFrom ? opening.publicVisibleFrom.toISOString() : null,
    publicVisibleUntil: opening.publicVisibleUntil ? opening.publicVisibleUntil.toISOString() : null,
    bookedAt: opening.bookedAt ? opening.bookedAt.toISOString() : null,
    cancelledAt: opening.cancelledAt ? opening.cancelledAt.toISOString() : null,
    note: opening.note ?? null,

    locationType: opening.locationType,
    locationId: opening.locationId,
    timeZone: opening.timeZone,
    location: opening.location
      ? {
          id: opening.location.id,
          type: opening.location.type,
          name: opening.location.name ?? null,
          city: opening.location.city ?? null,
          state: opening.location.state ?? null,
          formattedAddress: opening.location.formattedAddress ?? null,
          timeZone: opening.location.timeZone ?? null,
          lat: opening.location.lat ? opening.location.lat.toString() : null,
          lng: opening.location.lng ? opening.location.lng.toString() : null,
        }
      : null,

    recipientCount: opening._count.recipients,

    services: opening.services.map((row) => ({
      id: row.id,
      openingId: row.openingId,
      serviceId: row.serviceId,
      offeringId: row.offeringId,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      service: {
        id: row.service.id,
        name: row.service.name,
        minPrice: row.service.minPrice.toString(),
        defaultDurationMinutes: row.service.defaultDurationMinutes,
        isAddOnEligible: row.service.isAddOnEligible,
        addOnGroup: row.service.addOnGroup ?? null,
      },
      offering: {
        id: row.offering.id,
        title: row.offering.title ?? null,
        offersInSalon: row.offering.offersInSalon,
        offersMobile: row.offering.offersMobile,
        salonPriceStartingAt: decimalToString(row.offering.salonPriceStartingAt),
        salonDurationMinutes: row.offering.salonDurationMinutes,
        mobilePriceStartingAt: decimalToString(row.offering.mobilePriceStartingAt),
        mobileDurationMinutes: row.offering.mobileDurationMinutes,
      },
    })),

    tierPlans: opening.tierPlans.map((plan) => ({
      id: plan.id,
      openingId: plan.openingId,
      tier: plan.tier,
      scheduledFor: plan.scheduledFor.toISOString(),
      processedAt: plan.processedAt ? plan.processedAt.toISOString() : null,
      cancelledAt: plan.cancelledAt ? plan.cancelledAt.toISOString() : null,
      lastError: plan.lastError ?? null,
      offerType: plan.offerType,
      percentOff: plan.percentOff ?? null,
      amountOff: decimalToString(plan.amountOff),
      freeAddOnServiceId: plan.freeAddOnServiceId ?? null,
      freeAddOnService: plan.freeAddOnService
        ? {
            id: plan.freeAddOnService.id,
            name: plan.freeAddOnService.name,
          }
        : null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    })),
  }
}

function handleCreateError(error: unknown): Response | null {
  if (error instanceof CreateLastMinuteOpeningError) {
    return jsonFail(error.status, error.message, { code: error.code })
  }
  return null
}

async function cancelOpening(args: {
  professionalId: string
  openingId: string
}): Promise<
  | { ok: true; openingId: string; alreadyCancelled: boolean }
  | { ok: false; status: number; error: string }
> {
  const { professionalId, openingId } = args

  const existing = await prisma.lastMinuteOpening.findFirst({
    where: {
      id: openingId,
      professionalId,
    },
    select: {
      id: true,
      status: true,
      cancelledAt: true,
      bookedAt: true,
    },
  })

  if (!existing) {
    return { ok: false, status: 404, error: 'Opening not found.' }
  }

  if (existing.status === OpeningStatus.BOOKED || existing.bookedAt) {
    return { ok: false, status: 409, error: 'Booked openings cannot be cancelled.' }
  }

  if (existing.status === OpeningStatus.CANCELLED || existing.cancelledAt) {
    return { ok: true, openingId: existing.id, alreadyCancelled: true }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.lastMinuteOpening.update({
      where: { id: existing.id },
      data: {
        status: OpeningStatus.CANCELLED,
        cancelledAt: now,
        publicVisibleUntil: now,
      },
    })

    await tx.lastMinuteTierPlan.updateMany({
      where: {
        openingId: existing.id,
        processedAt: null,
        cancelledAt: null,
      },
      data: {
        cancelledAt: now,
      },
    })

    await tx.lastMinuteRecipient.updateMany({
      where: {
        openingId: existing.id,
        status: { in: [LastMinuteRecipientStatus.PLANNED, LastMinuteRecipientStatus.ENQUEUED] },
        cancelledAt: null,
      },
      data: {
        status: LastMinuteRecipientStatus.CANCELLED,
        cancelledAt: now,
      },
    })
  })

  return { ok: true, openingId: existing.id, alreadyCancelled: false }
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)
    const hoursParam = parseIntParam(url.searchParams.get('hours'))
    const daysParam = parseIntParam(url.searchParams.get('days'))
    const takeParam = parseIntParam(url.searchParams.get('take'))
    const statusParam = normalizeOpeningStatus(url.searchParams.get('status'))

    let hours = DEFAULT_HOURS
    if (typeof hoursParam === 'number') {
      hours = clampInt(hoursParam, 1, MAX_LOOKAHEAD_HOURS)
    } else if (typeof daysParam === 'number') {
      hours = clampInt(daysParam * 24, 1, MAX_LOOKAHEAD_HOURS)
    }

    const take = typeof takeParam === 'number' ? clampInt(takeParam, 1, MAX_TAKE) : DEFAULT_TAKE

    const now = new Date()
    const horizon = new Date(now.getTime() + hours * 60 * 60_000)

    const openings = await prisma.lastMinuteOpening.findMany({
      where: {
        professionalId,
        ...(statusParam ? { status: statusParam } : {}),
        startAt: { gte: now, lte: horizon },
      },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: openingSelect,
    })

    return jsonOk(
      {
        openings: openings.map(mapOpeningDto),
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/openings error', e)
    return jsonFail(500, 'Failed to load openings.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const offeringIdsResult = parseOfferingIds(body.offeringIds)
    if (!offeringIdsResult.ok) {
      return jsonFail(400, offeringIdsResult.error)
    }

    const startAt = parseIsoDate(body.startAt)
    if (!startAt) {
      return jsonFail(400, 'Missing or invalid startAt.')
    }

    const endAt = body.endAt === undefined || body.endAt === null ? null : parseIsoDate(body.endAt)
    if (body.endAt !== undefined && body.endAt !== null && !endAt) {
      return jsonFail(400, 'Invalid endAt.')
    }

    const launchAt = body.launchAt === undefined || body.launchAt === null ? null : parseIsoDate(body.launchAt)
    if (body.launchAt !== undefined && body.launchAt !== null && !launchAt) {
      return jsonFail(400, 'Invalid launchAt.')
    }

    const locationType = normalizeLocationType(body.locationType)
    if (!locationType) {
      return jsonFail(400, 'Missing or invalid locationType.')
    }

    const visibilityModeRaw = body.visibilityMode
    const visibilityMode =
      visibilityModeRaw === undefined || visibilityModeRaw === null
        ? null
        : normalizeVisibilityMode(visibilityModeRaw)

    if (visibilityModeRaw !== undefined && visibilityModeRaw !== null && !visibilityMode) {
      return jsonFail(400, 'Invalid visibilityMode.')
    }

    const noteResult = parseNote(body.note)
    if (!noteResult.ok) {
      return jsonFail(400, noteResult.error)
    }

    const tierPlansResult = parseTierPlans(body.tierPlans)
    if (!tierPlansResult.ok) {
      return jsonFail(400, tierPlansResult.error)
    }

    const created = await createLastMinuteOpening({
      professionalId,
      offeringIds: offeringIdsResult.value,
      startAt,
      endAt,
      locationType,
      requestedLocationId: cleanOptionalString(body.locationId),
      visibilityMode,
      note: noteResult.value,
      launchAt,
      tierPlans: tierPlansResult.value,
    })

    return jsonOk({ opening: mapOpeningDto(created) }, 201)
  } catch (e) {
    const handled = handleCreateError(e)
    if (handled) return handled

    console.error('POST /api/pro/openings error', e)
    return jsonFail(500, 'Failed to create opening.')
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { searchParams } = new URL(req.url)
    const id = pickString(searchParams.get('id'))
    if (!id) {
      return jsonFail(400, 'Missing id.')
    }

    const result = await cancelOpening({
      professionalId,
      openingId: id,
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error)
    }

    return jsonOk(
      {
        ok: true,
        id: result.openingId,
        alreadyCancelled: result.alreadyCancelled,
      },
      200,
    )
  } catch (e) {
    console.error('DELETE /api/pro/openings error', e)
    return jsonFail(500, 'Failed to cancel opening.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const openingId = pickString(body.openingId)
    if (!openingId) {
      return jsonFail(400, 'Missing openingId.')
    }

    const noteResult = parseNote(body.note)
    if (!noteResult.ok) {
      return jsonFail(400, noteResult.error)
    }

    const statusRaw = body.status
    const status = statusRaw === undefined ? undefined : normalizeOpeningStatus(statusRaw)
    if (statusRaw !== undefined && !status) {
      return jsonFail(400, 'Invalid status.')
    }

    const wantsCancel = status === OpeningStatus.CANCELLED

    if (status !== undefined && status !== OpeningStatus.CANCELLED) {
      return jsonFail(
        400,
        'This route only supports cancelling openings or updating the note. Booking and expiry state must come from booking/rollout flows.',
      )
    }

    if (wantsCancel) {
      const result = await cancelOpening({
        professionalId,
        openingId,
      })

      if (!result.ok) {
        return jsonFail(result.status, result.error)
      }
    }

    const opening = await prisma.lastMinuteOpening.findFirst({
      where: {
        id: openingId,
        professionalId,
      },
      select: {
        id: true,
        note: true,
      },
    })

    if (!opening) {
      return jsonFail(404, 'Opening not found.')
    }

    const shouldUpdateNote = Object.prototype.hasOwnProperty.call(body, 'note')
    if (shouldUpdateNote) {
      await prisma.lastMinuteOpening.update({
        where: { id: openingId },
        data: {
          note: noteResult.value,
        },
      })
    }

    const refreshed = await prisma.lastMinuteOpening.findUnique({
      where: { id: openingId },
      select: openingSelect,
    })

    if (!refreshed) {
      return jsonFail(404, 'Opening not found.')
    }

    return jsonOk({ opening: mapOpeningDto(refreshed) }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/openings error', e)
    return jsonFail(500, 'Failed to update opening.')
  }
}