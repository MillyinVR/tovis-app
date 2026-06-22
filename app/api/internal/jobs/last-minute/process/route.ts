// app/api/internal/jobs/last-minute/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  NotificationEventKey,
  OpeningStatus,
  Prisma,
} from '@prisma/client'
import { buildTier1WaitlistAudience } from '@/lib/lastMinute/audience/buildTier1WaitlistAudience'
import { buildTier2ReactivationAudience } from '@/lib/lastMinute/audience/buildTier2ReactivationAudience'
import { buildTier3DiscoveryAudience } from '@/lib/lastMinute/audience/buildTier3DiscoveryAudience'
import {
  expireOverduePriorityOffers,
  offerNextPriorityClient,
  hasActivePriorityOffer,
} from '@/lib/lastMinute/priorityOffer/priorityOffer'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const DEFAULT_TAKE = 25
const MAX_TAKE = 100

type DueTierPlanRow = Prisma.LastMinuteTierPlanGetPayload<{
  select: typeof dueTierPlanSelect
}>

type Candidate = {
  clientId: string
  matchedTier: LastMinuteTier
}

type PendingNotification = {
  recipientId: string
  clientId: string
  dedupeKey: string
  title: string
  body: string
  href: string
  data: Prisma.InputJsonObject
}

type ProcessTierPlanResult = {
  id: string
  openingId: string
  tier: LastMinuteTier
  status: 'processed' | 'skipped' | 'failed'
  createdRecipients: number
  error?: string
}

const dueTierPlanSelect = {
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
  opening: {
    select: {
      id: true,
      professionalId: true,
      status: true,
      startAt: true,
      endAt: true,
      bookedAt: true,
      cancelledAt: true,
      timeZone: true,
      locationType: true,
      note: true,
      professional: {
        select: {
          id: true,
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
          mobileRadiusMiles: true,
        },
      },
      location: {
        select: {
          lat: true,
          lng: true,
        },
      },
      services: {
        where: {
          offering: {
            is: {
              isActive: true,
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          serviceId: true,
          offeringId: true,
          sortOrder: true,
          service: {
            select: {
              id: true,
              name: true,
            },
          },
          offering: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.LastMinuteTierPlanSelect

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

function buildOfferingHref(plan: DueTierPlanRow): string {
  const firstOfferingId = plan.opening.services[0]?.offeringId
  if (!firstOfferingId) {
    return '/client'
  }

  const tz = plan.opening.timeZone
  return `/offerings/${encodeURIComponent(firstOfferingId)}?scheduledFor=${encodeURIComponent(
    plan.opening.startAt.toISOString(),
  )}&source=DISCOVERY&openingId=${encodeURIComponent(plan.opening.id)}&proTimeZone=${encodeURIComponent(tz)}`
}

function serviceSummary(plan: DueTierPlanRow): string {
  const names = Array.from(
    new Set(
      plan.opening.services
        .map((row) => row.service.name.trim())
        .filter((name) => name.length > 0),
    ),
  )

  const firstName = names[0]
  if (firstName === undefined) return 'a service'
  if (names.length === 1) return firstName
  return `${firstName} +${names.length - 1} more`
}

function incentiveLabel(plan: DueTierPlanRow): string | null {
  if (plan.offerType === LastMinuteOfferType.PERCENT_OFF && plan.percentOff != null) {
    return `${plan.percentOff}% off`
  }

  if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF && plan.amountOff) {
    return `$${plan.amountOff.toString()} off`
  }

  if (plan.offerType === LastMinuteOfferType.FREE_SERVICE) {
    return 'Free service'
  }

  if (plan.offerType === LastMinuteOfferType.FREE_ADD_ON) {
    return plan.freeAddOnService?.name || 'Free add-on'
  }

  return null
}

function buildNotificationContent(plan: DueTierPlanRow): {
  title: string
  body: string
  href: string
  data: Prisma.InputJsonObject
} {
  const proName =
    pickProfessionalPublicDisplayName(plan.opening.professional) ??
    plan.opening.professional.handle ??
    'your pro'

  const serviceLabel = serviceSummary(plan)
  const when = new Intl.DateTimeFormat(undefined, {
    timeZone: plan.opening.timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(plan.opening.startAt)

  const incentive = incentiveLabel(plan)

  return {
    title: 'Last-minute opening available',
    body: `${proName} has a last-minute opening for ${serviceLabel} on ${when}.${incentive ? ` Offer: ${incentive}` : ''}`,
    href: buildOfferingHref(plan),
    data: {
      openingId: plan.opening.id,
      professionalId: plan.opening.professionalId,
      tier: plan.tier,
      startAt: plan.opening.startAt.toISOString(),
      endAt: plan.opening.endAt ? plan.opening.endAt.toISOString() : null,
      timeZone: plan.opening.timeZone,
      locationType: plan.opening.locationType,
      serviceSummary: serviceLabel,
      incentiveLabel: incentive,
      proName,
      note: plan.opening.note ?? null,
    },
  }
}

async function buildDiscoveryCandidates(args: {
  tx: Prisma.TransactionClient
  plan: DueTierPlanRow
  now: Date
}): Promise<Candidate[]> {
  return buildTier3DiscoveryAudience({
    tx: args.tx,
    opening: args.plan.opening,
    now: args.now,
  })
}

async function processTierPlan(plan: DueTierPlanRow): Promise<ProcessTierPlanResult> {
  const now = new Date()

  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      const current = await tx.lastMinuteTierPlan.findUnique({
        where: { id: plan.id },
        select: {
          id: true,
          tier: true,
          openingId: true,
          processedAt: true,
          cancelledAt: true,
          scheduledFor: true,
          opening: {
            select: {
              id: true,
              status: true,
              startAt: true,
              endAt: true,
              bookedAt: true,
              cancelledAt: true,
              timeZone: true,
            },
          },
        },
      })

      if (!current || current.cancelledAt || current.processedAt) {
        return {
          status: 'skipped' as const,
          createdRecipients: 0,
          pendingNotifications: [] as PendingNotification[],
        }
      }

      if (current.scheduledFor.getTime() > now.getTime()) {
        return {
          status: 'skipped' as const,
          createdRecipients: 0,
          pendingNotifications: [] as PendingNotification[],
        }
      }

      if (
        current.opening.status !== OpeningStatus.ACTIVE ||
        current.opening.bookedAt ||
        current.opening.cancelledAt ||
        current.opening.startAt.getTime() <= now.getTime()
      ) {
        await tx.lastMinuteTierPlan.update({
          where: { id: current.id },
          data: {
            processedAt: now,
            lastError: 'Skipped because the opening is no longer active or already started.',
          },
        })

        return {
          status: 'processed' as const,
          createdRecipients: 0,
          pendingNotifications: [] as PendingNotification[],
        }
      }

      if (!isValidIanaTimeZone(current.opening.timeZone)) {
        await tx.lastMinuteTierPlan.update({
          where: { id: current.id },
          data: {
            processedAt: now,
            lastError: 'Skipped because the opening timezone is invalid.',
          },
        })

        return {
          status: 'processed' as const,
          createdRecipients: 0,
          pendingNotifications: [] as PendingNotification[],
        }
      }

      if (plan.tier === LastMinuteTier.WAITLIST) {
        const settings = await tx.lastMinuteSettings.findUnique({
          where: { professionalId: plan.opening.professionalId },
          select: { priorityOfferEnabled: true, priorityOfferMinutes: true },
        })

        if (settings?.priorityOfferEnabled) {
          return {
            status: 'priority_offer' as const,
            createdRecipients: 0,
            pendingNotifications: [] as PendingNotification[],
            priorityMinutes: settings.priorityOfferMinutes,
          }
        }
      }

      let candidates: Candidate[] = []

      if (plan.tier === LastMinuteTier.WAITLIST) {
        candidates = await buildTier1WaitlistAudience({
          tx,
          opening: plan.opening,
          now,
        })
      } else if (plan.tier === LastMinuteTier.REACTIVATION) {
        candidates = await buildTier2ReactivationAudience({
          tx,
          opening: plan.opening,
          now,
        })
      } else {
        candidates = await buildDiscoveryCandidates({ tx, plan, now })
      }

      const notification = buildNotificationContent(plan)
      const pendingNotifications: PendingNotification[] = []
      let createdRecipients = 0

      for (const candidate of candidates) {
        const existing = await tx.lastMinuteRecipient.findUnique({
          where: {
            openingId_clientId: {
              openingId: plan.opening.id,
              clientId: candidate.clientId,
            },
          },
          select: {
            id: true,
          },
        })

        if (existing) {
          continue
        }

        const recipient = await tx.lastMinuteRecipient.create({
          data: {
            openingId: plan.opening.id,
            clientId: candidate.clientId,
            firstMatchedTier: candidate.matchedTier,
            notifiedTier: plan.tier,
            status: LastMinuteRecipientStatus.ENQUEUED,
            notifiedAt: now,
            matchedContext: {
              tier: plan.tier,
              source: 'last-minute-job',
              scheduledFor: plan.scheduledFor.toISOString(),
            },
          },
          select: {
            id: true,
          },
        })

        pendingNotifications.push({
          recipientId: recipient.id,
          clientId: candidate.clientId,
          dedupeKey: `last-minute-opening:${plan.opening.id}:client:${candidate.clientId}`,
          title: notification.title,
          body: notification.body,
          href: notification.href,
          data: {
            ...notification.data,
            recipientId: recipient.id,
          },
        })

        createdRecipients += 1
      }

      await tx.lastMinuteTierPlan.update({
        where: { id: plan.id },
        data: {
          processedAt: now,
          lastError: null,
        },
      })

      return {
        status: 'processed' as const,
        createdRecipients,
        pendingNotifications,
      }
    })

    if (transactionResult.status === 'priority_offer') {
      await expireOverduePriorityOffers(plan.openingId)

      const notification = buildNotificationContent(plan)
      const result = await offerNextPriorityClient({
        openingId: plan.openingId,
        professionalId: plan.opening.professionalId,
        priorityMinutes: 'priorityMinutes' in transactionResult
          ? (transactionResult.priorityMinutes as number)
          : 30,
        notificationContent: notification,
      })

      if (!result.offered && result.reason === 'no_candidates') {
        await prisma.lastMinuteTierPlan.update({
          where: { id: plan.id },
          data: { processedAt: now, lastError: null },
        })
      }

      return {
        id: plan.id,
        openingId: plan.openingId,
        tier: plan.tier,
        status: 'processed',
        createdRecipients: result.offered ? 1 : 0,
      }
    }

    if (transactionResult.status !== 'processed') {
      return {
        id: plan.id,
        openingId: plan.openingId,
        tier: plan.tier,
        status: transactionResult.status,
        createdRecipients: transactionResult.createdRecipients,
      }
    }

    for (const pending of transactionResult.pendingNotifications) {
      const clientNotification = await upsertClientNotification({
        clientId: pending.clientId,
        eventKey: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
        title: pending.title,
        body: pending.body,
        href: pending.href,
        dedupeKey: pending.dedupeKey,
        data: pending.data,
      })

      await prisma.lastMinuteRecipient.update({
        where: { id: pending.recipientId },
        data: {
          sourceDispatchKey: `client-notification:${clientNotification.id}`,
        },
      })
    }

    return {
      id: plan.id,
      openingId: plan.openingId,
      tier: plan.tier,
      status: 'processed',
      createdRecipients: transactionResult.createdRecipients,
    }
  } catch (err: unknown) {
    const message = 'Failed to process last-minute tier plan'
    await prisma.lastMinuteTierPlan.updateMany({
      where: {
        id: plan.id,
        processedAt: null,
      },
      data: {
        lastError: message,
      },
    })

    return {
      id: plan.id,
      openingId: plan.openingId,
      tier: plan.tier,
      status: 'failed',
      createdRecipients: 0,
      error: message,
    }
  }
}

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(500, 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.')
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const now = new Date()
  const take = readTake(req)

  const duePlans = await prisma.lastMinuteTierPlan.findMany({
    where: {
      processedAt: null,
      cancelledAt: null,
      scheduledFor: {
        lte: now,
      },
      opening: {
        status: OpeningStatus.ACTIVE,
        bookedAt: null,
        cancelledAt: null,
      },
    },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take,
    select: dueTierPlanSelect,
  })

  const results = await Promise.all(duePlans.map((plan) => processTierPlan(plan)))

  const processedCount = results.filter((row) => row.status === 'processed').length
  const skippedCount = results.filter((row) => row.status === 'skipped').length
  const failed = results.filter((row) => row.status === 'failed')
  const createdRecipients = results.reduce((sum, row) => sum + row.createdRecipients, 0)

  return jsonOk({
    scannedCount: duePlans.length,
    processedCount,
    skippedCount,
    failedCount: failed.length,
    createdRecipients,
    failed: failed.map((row) => ({
      id: row.id,
      openingId: row.openingId,
      tier: row.tier,
      error: row.error ?? 'Unknown error',
    })),
    processed: results
      .filter((row) => row.status === 'processed')
      .map((row) => ({
        id: row.id,
        openingId: row.openingId,
        tier: row.tier,
        createdRecipients: row.createdRecipients,
      })),
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/jobs/last-minute/process error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/last-minute/process error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}