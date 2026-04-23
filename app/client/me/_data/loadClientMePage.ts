// app/client/me/_data/loadClientMePage.ts
import 'server-only'

import { redirect } from 'next/navigation'
import { BookingStatus, Prisma } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { getBoardSummaries } from '@/lib/boards'
import {
  buildMyFollowingListResponse,
  listFollowingPage,
} from '@/lib/follows'
import {
  buildClientBookingDTO,
  type ClientBookingDTO,
} from '@/lib/dto/clientBooking'
import { computePendingConsultation } from '@/app/client/bookings/[id]/_view/buildBookingViewModel'

type CurrentUserResult = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<CurrentUserResult> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

export const clientMeProfileSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    avatarUrl: true,
    claimStatus: true,
    claimedAt: true,
  })

export type ClientMeProfileRow = Prisma.ClientProfileGetPayload<{
  select: typeof clientMeProfileSelect
}>

export const clientMeBookingSelect =
  Prisma.validator<Prisma.BookingSelect>()({
    id: true,
    status: true,
    source: true,
    sessionStep: true,
    scheduledFor: true,
    finishedAt: true,

    subtotalSnapshot: true,
    serviceSubtotalSnapshot: true,
    productSubtotalSnapshot: true,
    totalAmount: true,
    tipAmount: true,
    taxAmount: true,
    discountAmount: true,
    checkoutStatus: true,
    selectedPaymentMethod: true,
    paymentAuthorizedAt: true,
    paymentCollectedAt: true,

    totalDurationMinutes: true,
    bufferMinutes: true,

    locationType: true,
    locationId: true,
    locationTimeZone: true,
    locationAddressSnapshot: true,

    service: {
      select: {
        id: true,
        name: true,
      },
    },

    professional: {
      select: {
        id: true,
        businessName: true,
        location: true,
        timeZone: true,
      },
    },

    location: {
      select: {
        id: true,
        name: true,
        formattedAddress: true,
        city: true,
        state: true,
        timeZone: true,
      },
    },

    consultationNotes: true,
    consultationPrice: true,
    consultationConfirmedAt: true,

    consultationApproval: {
      select: {
        status: true,
        proposedServicesJson: true,
        proposedTotal: true,
        notes: true,
        approvedAt: true,
        rejectedAt: true,
      },
    },

    serviceItems: {
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 80,
      select: {
        id: true,
        itemType: true,
        parentItemId: true,
        sortOrder: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,
        serviceId: true,
        service: {
          select: {
            name: true,
          },
        },
      },
    },

    productSales: {
      orderBy: [{ createdAt: 'asc' }],
      take: 80,
      select: {
        id: true,
        productId: true,
        quantity: true,
        unitPrice: true,
        product: {
          select: {
            name: true,
          },
        },
      },
    },
  })

type ClientMeBookingRow = Prisma.BookingGetPayload<{
  select: typeof clientMeBookingSelect
}>

type ClientMeHistoryItem =
  | {
      kind: 'completed'
      label: 'BOOKED'
      booking: ClientBookingDTO
    }
  | {
      kind: 'upcoming'
      label: 'UPCOMING'
      booking: ClientBookingDTO
    }

export type ClientMePageData = {
  user: AuthedClientUser
  profile: ClientMeProfileRow
  boards: Awaited<ReturnType<typeof getBoardSummaries>>
  following: ReturnType<typeof buildMyFollowingListResponse>
  counts: {
    boards: number
    saved: number
    booked: number
    following: number
  }
  upcomingNotificationBooking: ClientBookingDTO | null
  history: ClientMeHistoryItem[]
}

function isAuthedClientUser(
  user: CurrentUserResult | null,
): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

async function requireAuthedClientUser(): Promise<AuthedClientUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isAuthedClientUser(user)) {
    redirect('/login?from=/client/me')
  }

  return user
}

function toTimestamp(value: string): number {
  return new Date(value).getTime()
}

function isFutureBooking(booking: ClientBookingDTO, now: Date): boolean {
  return toTimestamp(booking.scheduledFor) >= now.getTime()
}

function isCompletedBooking(booking: ClientBookingDTO): boolean {
  return booking.status === BookingStatus.COMPLETED
}

function isAcceptedBooking(booking: ClientBookingDTO): boolean {
  return booking.status === BookingStatus.ACCEPTED
}

function compareByScheduledAsc(
  left: ClientBookingDTO,
  right: ClientBookingDTO,
): number {
  return toTimestamp(left.scheduledFor) - toTimestamp(right.scheduledFor)
}

function compareHistoryItems(
  left: ClientMeHistoryItem,
  right: ClientMeHistoryItem,
): number {
  if (left.kind !== right.kind) {
    return left.kind === 'upcoming' ? -1 : 1
  }

  if (left.kind === 'upcoming') {
    return compareByScheduledAsc(left.booking, right.booking)
  }

  return toTimestamp(right.booking.scheduledFor) - toTimestamp(left.booking.scheduledFor)
}

export async function loadClientMePage(): Promise<ClientMePageData> {
  const user = await requireAuthedClientUser()
  const clientId = user.clientProfile.id
  const now = new Date()

  const [
    profile,
    unreadBookingRows,
    bookingRows,
    boards,
    followingPage,
    boardCount,
    followingCount,
    bookedCount,
    uniqueSavedRows,
  ] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: clientMeProfileSelect,
    }),

    prisma.clientNotification.findMany({
      where: {
        clientId,
        bookingId: {
          not: null,
        },
        readAt: null,
      },
      select: {
        bookingId: true,
      },
      take: 1000,
    }),

    prisma.booking.findMany({
      where: {
        clientId,
        status: {
          in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED],
        },
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: 300,
      select: clientMeBookingSelect,
    }),

    getBoardSummaries(prisma, {
      clientId,
      viewerClientId: clientId,
      take: 24,
      skip: 0,
    }),

    listFollowingPage(prisma, {
      clientId,
      viewerClientId: clientId,
      take: 24,
      skip: 0,
    }),

    prisma.board.count({
      where: {
        clientId,
      },
    }),

    prisma.proFollow.count({
      where: {
        clientId,
      },
    }),

    prisma.booking.count({
      where: {
        clientId,
        status: {
          in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED],
        },
      },
    }),

    prisma.boardItem.findMany({
      where: {
        board: {
          clientId,
        },
      },
      distinct: ['lookPostId'],
      select: {
        lookPostId: true,
      },
    }),
  ])

  if (!profile) {
    redirect('/login?from=/client/me')
  }

  const unreadBookingIds = new Set(
    unreadBookingRows
      .map((row) => row.bookingId)
      .filter(
        (bookingId): bookingId is string =>
          typeof bookingId === 'string' && bookingId.trim().length > 0,
      ),
  )

  const bookings = await Promise.all(
    bookingRows.map((booking) =>
      buildClientBookingDTO({
        booking,
        unreadAftercare: unreadBookingIds.has(booking.id),
        hasPendingConsultationApproval: computePendingConsultation({
          status: booking.status,
          sessionStep: booking.sessionStep,
          finishedAt: booking.finishedAt,
          consultationApproval: booking.consultationApproval,
        }),
      }),
    ),
  )

  const upcomingBookings = bookings
    .filter(
      (booking) => isAcceptedBooking(booking) && isFutureBooking(booking, now),
    )
    .sort(compareByScheduledAsc)

  const completedBookings = bookings
    .filter((booking) => isCompletedBooking(booking))
    .sort(
      (left, right) =>
        toTimestamp(right.scheduledFor) - toTimestamp(left.scheduledFor),
    )

  const upcomingNotificationBooking = upcomingBookings[0] ?? null

  const historyUpcoming: ClientMeHistoryItem[] = upcomingBookings.map((booking) => ({
    kind: 'upcoming',
    label: 'UPCOMING',
    booking,
  }))

  const historyCompleted: ClientMeHistoryItem[] = completedBookings.map((booking) => ({
    kind: 'completed',
    label: 'BOOKED',
    booking,
  }))

  const following = buildMyFollowingListResponse({
    clientId,
    items: followingPage.items,
    pagination: followingPage.pagination,
  })

  return {
    user,
    profile,
    boards,
    following,
    counts: {
      boards: boardCount,
      saved: uniqueSavedRows.length,
      booked: bookedCount,
      following: followingCount,
    },
    upcomingNotificationBooking,
    history: [...historyUpcoming, ...historyCompleted].sort(compareHistoryItems),
  }
}