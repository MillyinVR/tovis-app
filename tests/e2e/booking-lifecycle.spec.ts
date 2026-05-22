import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  Prisma,
  PrismaClient,
  Role,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

import {
  seedBookingFlow,
  type SeedBookingFlowResult,
} from './fixtures/seedBookingFlow'
import { teardownBookingFlow } from './fixtures/teardownBookingFlow'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL for booking lifecycle E2E.')
}

const dangerousMainProjectRef = 'rqhhvuaoksuvbvlypztn'
if (
  databaseUrl.includes(dangerousMainProjectRef) &&
  process.env.E2E_ALLOW_MAIN_SUPABASE !== 'true'
) {
  throw new Error(
    [
      'Refusing to run booking lifecycle E2E against the main Supabase project.',
      'Use a local/dev database, or set E2E_ALLOW_MAIN_SUPABASE=true only if you really mean it.',
    ].join(' '),
  )
}

const prisma = new PrismaClient()
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'

type BookingServiceItemForFlow = {
  id: string
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType | null
  priceSnapshot: Prisma.Decimal
  durationMinutesSnapshot: number
  sortOrder: number
  service: {
    name: string
    category: {
      name: string
    } | null
  } | null
}

type BookingForFlow = {
  id: string
  clientId: string
  professionalId: string
  serviceId: string | null
  offeringId: string | null
  status: BookingStatus
  sessionStep: SessionStep | null
  checkoutStatus: BookingCheckoutStatus
  finishedAt: Date | null
  paymentCollectedAt: Date | null
  subtotalSnapshot: Prisma.Decimal | null
  totalDurationMinutes: number
  serviceItems: BookingServiceItemForFlow[]
  aftercareSummary: {
    id: string
    sentToClientAt: Date | null
    version: number
    } | null
}

function makeIdempotencyKey(label: string): string {
  return `e2e_${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function baseUrlFrom(value: string | undefined): string {
  return value ?? process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

function trustedJsonHeaders(args: {
  baseURL?: string
  idempotencyKey?: string
  requestId?: string
}): Record<string, string> {
  const origin = normalizeBaseUrl(args.baseURL)

  return {
    'content-type': 'application/json',
    origin,
    referer: `${origin}/`,
    ...(args.idempotencyKey
      ? {
          'idempotency-key': args.idempotencyKey,
        }
      : {}),
    ...(args.requestId
      ? {
          'x-request-id': args.requestId,
        }
      : {}),
  }
}

async function loginAs(args: {
  page: Page
  email: string
  password: string
}): Promise<void> {
  await args.page.goto('/login')

  await args.page.getByLabel(/email/i).fill(args.email)
  await args.page.getByLabel(/password/i).fill(args.password)

  await Promise.all([
    args.page
      .waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: 15_000,
      })
      .catch(() => null),
    args.page
      .getByRole('button', {
        name: /sign in|log in|login/i,
      })
      .click(),
  ])

  await expect(args.page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function loginProfessionalContext(args: {
  browser: Browser
  baseURL: string
  seed: SeedBookingFlowResult
}): Promise<BrowserContext> {
  const context = await args.browser.newContext({
    baseURL: args.baseURL,
  })

  const page = await context.newPage()

  await loginAs({
    page,
    email: args.seed.credentials.professional.email,
    password: args.seed.credentials.professional.password,
  })

  await page.close()

  return context
}

async function postJson<T = Record<string, unknown>>(args: {
  request: APIRequestContext
  path: string
  body?: unknown
  idempotencyKey?: string
  requestId?: string
  baseURL?: string
}): Promise<T> {
  const response = await args.request.post(args.path, {
    headers: trustedJsonHeaders({
      baseURL: args.baseURL,
      idempotencyKey: args.idempotencyKey,
      requestId: args.requestId,
    }),
    data: args.body ?? {},
  })

  if (!response.ok()) {
    throw new Error(
      `POST ${args.path} failed with ${response.status()}: ${await response.text()}`,
    )
  }

  return (await response.json()) as T
}

async function patchJson<T = Record<string, unknown>>(args: {
  request: APIRequestContext
  path: string
  body?: unknown
  idempotencyKey?: string
  requestId?: string
  baseURL?: string
}): Promise<T> {
  const response = await args.request.patch(args.path, {
    headers: trustedJsonHeaders({
      baseURL: args.baseURL,
      idempotencyKey: args.idempotencyKey,
      requestId: args.requestId,
    }),
    data: args.body ?? {},
  })

  if (!response.ok()) {
    throw new Error(
      `PATCH ${args.path} failed with ${response.status()}: ${await response.text()}`,
    )
  }

  return (await response.json()) as T
}

function centsFromMoney(
  value: Prisma.Decimal | number | string | null | undefined,
): number {
  if (value == null) return 0

  const numeric =
    value instanceof Prisma.Decimal ? value.toNumber() : Number(value)

  if (!Number.isFinite(numeric)) return 0

  return Math.round(numeric * 100)
}

function moneyTextFromCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

async function loadBookingForFlow(bookingId: string): Promise<BookingForFlow> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      offeringId: true,
      status: true,
      sessionStep: true,
      checkoutStatus: true,
      finishedAt: true,
      paymentCollectedAt: true,
      subtotalSnapshot: true,
      totalDurationMinutes: true,
      aftercareSummary: {
        select: {
            id: true,
            sentToClientAt: true,
            version: true,
        },
        },
      serviceItems: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          serviceId: true,
          offeringId: true,
          itemType: true,
          priceSnapshot: true,
          durationMinutesSnapshot: true,
          sortOrder: true,
          service: {
            select: {
              name: true,
              category: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found.`)
  }

  if (!booking.serviceItems.length) {
    throw new Error(
      `Booking ${bookingId} has no serviceItems; full lifecycle E2E cannot build consultation/final-review payloads.`,
    )
  }

  return booking
}

function buildProposalPayload(booking: BookingForFlow) {
  const items = booking.serviceItems.map((item, index) => {
    const itemType =
      item.itemType ??
      (index === 0 ? BookingServiceItemType.BASE : BookingServiceItemType.ADD_ON)

    return {
      bookingServiceItemId: item.id,
      offeringId: item.offeringId,
      serviceId: item.serviceId,
      itemType,
      label: item.service?.name ?? `Service ${index + 1}`,
      categoryName: item.service?.category?.name ?? null,
      price: item.priceSnapshot.toFixed(2),
      durationMinutes: item.durationMinutesSnapshot,
      notes: null,
      sortOrder: item.sortOrder ?? index,
      source: 'BOOKING',
    }
  })

  const proposedCents = booking.serviceItems.reduce(
    (sum, item) => sum + centsFromMoney(item.priceSnapshot),
    0,
  )

  return {
    proposedServicesJson: {
      currency: 'USD',
      items,
    },
    proposedTotal: moneyTextFromCents(proposedCents),
    notes: 'E2E consultation proposal.',
  }
}

function buildFinalReviewPayload(booking: BookingForFlow) {
  const finalLineItems = booking.serviceItems.map((item, index) => {
    const itemType =
      item.itemType ??
      (index === 0 ? BookingServiceItemType.BASE : BookingServiceItemType.ADD_ON)

    return {
      bookingServiceItemId: item.id,
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      itemType,
      price: item.priceSnapshot.toFixed(2),
      durationMinutes: item.durationMinutesSnapshot,
      notes:
        itemType === BookingServiceItemType.BASE ? 'E2E final review.' : null,
      sortOrder: item.sortOrder ?? index,
    }
  })

  const expectedSubtotalCents = booking.serviceItems.reduce(
    (sum, item) => sum + centsFromMoney(item.priceSnapshot),
    0,
  )

  return {
    finalLineItems,
    expectedSubtotal: moneyTextFromCents(expectedSubtotalCents),
    recommendedProducts: [
      {
        name: 'E2E Curl Cream',
        url: 'https://example.com/e2e-curl-cream',
        note: 'Use after washing.',
      },
    ],
    rebookMode: AftercareRebookMode.NONE,
    rebookedFor: null,
    rebookWindowStart: null,
    rebookWindowEnd: null,
  }
}

async function attachBookingMedia(args: {
  bookingId: string
  professionalId: string
  uploadedByUserId: string
  phase: MediaPhase
  caption: string
}): Promise<void> {
  const phaseSegment =
    args.phase === MediaPhase.BEFORE
      ? 'before'
      : args.phase === MediaPhase.AFTER
        ? 'after'
        : 'other'

  await prisma.mediaAsset.create({
    data: {
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      uploadedByUserId: args.uploadedByUserId,
      uploadedByRole: Role.PRO,
      storageBucket: 'booking-media',
      storagePath: `bookings/${args.bookingId}/${phaseSegment}/e2e-${phaseSegment}.jpg`,
      thumbBucket: null,
      thumbPath: null,
      url: `https://example.com/e2e/${args.bookingId}/${phaseSegment}.jpg`,
      thumbUrl: null,
      caption: args.caption,
      phase: args.phase,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PRO_CLIENT,
      reviewId: null,
      reviewLocked: false,
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,
    },
  })
}

function nextStartableQuarterHour(): Date {
  const now = new Date()
  const scheduledFor = new Date(now)

  scheduledFor.setUTCSeconds(0, 0)

  const minutes = scheduledFor.getUTCMinutes()
  const remainder = minutes % 15

  if (remainder !== 0) {
    scheduledFor.setUTCMinutes(minutes + (15 - remainder))
  }

  const diffMs = scheduledFor.getTime() - now.getTime()
  const fourteenMinutesMs = 14 * 60 * 1000

  if (diffMs > fourteenMinutesMs) {
    scheduledFor.setUTCMinutes(scheduledFor.getUTCMinutes() - 15)
  }

  return scheduledFor
}

async function createInitialBookingForFlow(
  seed: SeedBookingFlowResult,
): Promise<string> {
  const scheduledFor = nextStartableQuarterHour()


  const booking = await prisma.booking.create({
    data: {
      clientId: seed.credentials.client.clientId,
      professionalId: seed.credentials.professional.professionalId,
      serviceId: seed.services.base.id,
      offeringId: seed.offering.id,
      scheduledFor,
      status: BookingStatus.PENDING,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: seed.locations.salon.id,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: {
        formattedAddress: '123 Salon St, San Diego, CA 92101',
      },
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressId: null,
      clientAddressSnapshot: Prisma.JsonNull,
      clientAddressLatSnapshot: null,
      clientAddressLngSnapshot: null,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      serviceSubtotalSnapshot: new Prisma.Decimal('100.00'),
      productSubtotalSnapshot: new Prisma.Decimal('0.00'),
      totalAmount: new Prisma.Decimal('100.00'),
      depositAmount: null,
      tipAmount: new Prisma.Decimal('0.00'),
      taxAmount: new Prisma.Decimal('0.00'),
      discountAmount: new Prisma.Decimal('0.00'),
      totalDurationMinutes: 60,
      bufferMinutes: 15,
      serviceItems: {
        create: {
          serviceId: seed.services.base.id,
          offeringId: seed.offering.id,
          itemType: BookingServiceItemType.BASE,
          priceSnapshot: new Prisma.Decimal('100.00'),
          durationMinutesSnapshot: 60,
          sortOrder: 0,
        },
      },
    },
    select: {
      id: true,
    },
  })

  return booking.id
}

async function expectBookingState(args: {
  bookingId: string
  status?: BookingStatus
  step?: SessionStep
  checkoutStatus?: BookingCheckoutStatus
}): Promise<BookingForFlow> {
  const booking = await loadBookingForFlow(args.bookingId)

  if (args.status) {
    expect(booking.status).toBe(args.status)
  }

  if (args.step) {
    expect(booking.sessionStep).toBe(args.step)
  }

  if (args.checkoutStatus) {
    expect(booking.checkoutStatus).toBe(args.checkoutStatus)
  }

  return booking
}

async function markSeededUsersVerified(seed: SeedBookingFlowResult): Promise<void> {
  const verifiedAt = new Date()

  await prisma.user.updateMany({
    where: {
      id: {
        in: [
          seed.credentials.client.userId,
          seed.credentials.professional.userId,
        ],
      },
    },
    data: {
      emailVerifiedAt: verifiedAt,
      phoneVerifiedAt: verifiedAt,
    },
  })
}

async function makeSeededLocationsStartable(
  seed: SeedBookingFlowResult,
): Promise<void> {
  const locationIds = [
    seed.locations.salon.id,
    seed.locations.mobileBase?.id,
  ].filter((value): value is string => Boolean(value))

  await prisma.professionalLocation.updateMany({
    where: {
      id: {
        in: locationIds,
      },
    },
    data: {
      advanceNoticeMinutes: 0,
    },
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('full booking lifecycle launch proof', () => {
  let seed: SeedBookingFlowResult | null = null
  let createdBookingId: string | null = null

  test.beforeAll(async () => {
    await prisma.$connect()
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test.beforeEach(async () => {
  seed = await seedBookingFlow(
    { prisma },
    {
      withSavedAddress: true,
      withAddOn: false,
      offersInSalon: true,
      offersMobile: false,
    },
  )

  await markSeededUsersVerified(seed)
  await makeSeededLocationsStartable(seed)

  createdBookingId = null
})

  test.afterEach(async () => {
    if (createdBookingId) {
      await prisma.mediaAsset.deleteMany({
        where: {
          bookingId: createdBookingId,
        },
      })
    }

    await teardownBookingFlow({
      prisma,
      seed,
    })

    seed = null
    createdBookingId = null
  })

  test('client books, pro completes session, sends aftercare, and booking completes', async ({
    page,
    browser,
    baseURL,
  }) => {
    if (!seed) throw new Error('Missing seed.')

    const resolvedBaseUrl = baseUrlFrom(baseURL)

    const bookingId = await createInitialBookingForFlow(seed)
    createdBookingId = bookingId

    let booking = await expectBookingState({
      bookingId,
      status: BookingStatus.PENDING,
    })

    expect(booking.clientId).toBe(seed.credentials.client.clientId)
    expect(booking.professionalId).toBe(
      seed.credentials.professional.professionalId,
    )

    const proContext = await loginProfessionalContext({
      browser,
      baseURL: resolvedBaseUrl,
      seed,
    })

    try {
      const proRequest = proContext.request
      const clientRequest = page.context().request

      await patchJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}`,
        idempotencyKey: makeIdempotencyKey('accept'),
        requestId: makeIdempotencyKey('req_accept'),
        baseURL: resolvedBaseUrl,
        body: {
          status: BookingStatus.ACCEPTED,
          notifyClient: false,
        },
      })

      await expectBookingState({
        bookingId,
        status: BookingStatus.ACCEPTED,
      })

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/session/start`,
        idempotencyKey: makeIdempotencyKey('start'),
        requestId: makeIdempotencyKey('req_start'),
        baseURL: resolvedBaseUrl,
      })

      booking = await expectBookingState({
        bookingId,
        status: BookingStatus.IN_PROGRESS,
        step: SessionStep.CONSULTATION,
      })

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/consultation-proposal`,
        idempotencyKey: makeIdempotencyKey('consultation_proposal'),
        requestId: makeIdempotencyKey('req_consultation_proposal'),
        baseURL: resolvedBaseUrl,
        body: buildProposalPayload(booking),
      })

      await expectBookingState({
        bookingId,
        status: BookingStatus.IN_PROGRESS,
        step: SessionStep.CONSULTATION_PENDING_CLIENT,
      })

      await postJson({
        request: clientRequest,
        path: `/api/client/bookings/${bookingId}/consultation`,
        idempotencyKey: makeIdempotencyKey('client_consultation_approve'),
        requestId: makeIdempotencyKey('req_client_consultation_approve'),
        baseURL: resolvedBaseUrl,
        body: {
          action: 'APPROVE',
        },
      })

      booking = await expectBookingState({
        bookingId,
        status: BookingStatus.IN_PROGRESS,
        step: SessionStep.BEFORE_PHOTOS,
      })

      await attachBookingMedia({
        bookingId,
        professionalId: seed.credentials.professional.professionalId,
        uploadedByUserId: seed.credentials.professional.userId,
        phase: MediaPhase.BEFORE,
        caption: 'E2E before photo.',
      })

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/session/step`,
        idempotencyKey: makeIdempotencyKey('service_in_progress'),
        requestId: makeIdempotencyKey('req_service_in_progress'),
        baseURL: resolvedBaseUrl,
        body: {
          step: SessionStep.SERVICE_IN_PROGRESS,
        },
      })

      await expectBookingState({
        bookingId,
        status: BookingStatus.IN_PROGRESS,
        step: SessionStep.SERVICE_IN_PROGRESS,
      })

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/session/finish`,
        idempotencyKey: makeIdempotencyKey('finish_session'),
        requestId: makeIdempotencyKey('req_finish_session'),
        baseURL: resolvedBaseUrl,
      })

      booking = await expectBookingState({
        bookingId,
        status: BookingStatus.IN_PROGRESS,
        step: SessionStep.FINISH_REVIEW,
      })

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/final-review`,
        idempotencyKey: makeIdempotencyKey('final_review'),
        requestId: makeIdempotencyKey('req_final_review'),
        baseURL: resolvedBaseUrl,
        body: buildFinalReviewPayload(booking),
      })

      await expectBookingState({
        bookingId,
        status: BookingStatus.IN_PROGRESS,
        step: SessionStep.AFTER_PHOTOS,
      })

      await attachBookingMedia({
        bookingId,
        professionalId: seed.credentials.professional.professionalId,
        uploadedByUserId: seed.credentials.professional.userId,
        phase: MediaPhase.AFTER,
        caption: 'E2E after photo.',
      })

      booking = await loadBookingForFlow(bookingId)

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/aftercare`,
        idempotencyKey: makeIdempotencyKey('aftercare_send'),
        requestId: makeIdempotencyKey('req_aftercare_send'),
        baseURL: resolvedBaseUrl,
        body: {
          notes: 'E2E aftercare instructions.',
          sendToClient: true,
          recommendedProducts: [
            {
              externalName: 'E2E Silk Pillowcase',
              externalUrl: 'https://example.com/e2e-silk-pillowcase',
              note: 'Use nightly.',
            },
          ],
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
          createRebookReminder: false,
          rebookReminderDaysBefore: 2,
          createProductReminder: false,
          productReminderDaysAfter: 7,
          version: booking.aftercareSummary?.version ?? 0,
          timeZone: 'America/Los_Angeles',
        },
      })

      booking = await loadBookingForFlow(bookingId)

      expect(booking.aftercareSummary?.sentToClientAt).toBeTruthy()

      await postJson({
        request: proRequest,
        path: `/api/pro/bookings/${bookingId}/checkout/waive`,
        idempotencyKey: makeIdempotencyKey('checkout_waive'),
        requestId: makeIdempotencyKey('req_checkout_waive'),
        baseURL: resolvedBaseUrl,
        body: {
          reason: 'E2E launch lifecycle proof.',
        },
      })

      const completed = await expectBookingState({
        bookingId,
        status: BookingStatus.COMPLETED,
        step: SessionStep.DONE,
        checkoutStatus: BookingCheckoutStatus.WAIVED,
      })

      expect(completed.finishedAt).toBeTruthy()
      expect(completed.aftercareSummary?.sentToClientAt).toBeTruthy()

      await expect(
        prisma.mediaAsset.count({
          where: {
            bookingId,
            professionalId: seed.credentials.professional.professionalId,
            uploadedByRole: Role.PRO,
            visibility: MediaVisibility.PRO_CLIENT,
            phase: {
              in: [MediaPhase.BEFORE, MediaPhase.AFTER],
            },
          },
        }),
      ).resolves.toBe(2)
    } finally {
      await proContext.close()
    }
  })
})