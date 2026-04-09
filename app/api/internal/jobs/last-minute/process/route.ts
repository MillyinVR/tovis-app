// app/api/internal/jobs/last-minute/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'
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
          handle: true,
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

function getJobSecret(): string | null {
  const raw = process.env.INTERNAL_JOB_SECRET ?? process.env.CRON_SECRET ?? null
  if (!raw) return null

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
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

  if (names.length === 0) return 'a service'
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1} more`
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
    plan.opening.professional.businessName ??
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

async function processTierPlan(plan: DueTierPlanRow): Promise<{
  id: string
  openingId: string
  tier: LastMinuteTier
  status: 'processed' | 'skipped' | 'failed'
  createdRecipients: number
  error?: string
}> {
  const now = new Date()

  try {
    const result = await prisma.$transaction(async (tx) => {
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
        }
      }

      if (current.scheduledFor.getTime() > now.getTime()) {
        return {
          status: 'skipped' as const,
          createdRecipients: 0,
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
        }
      }

      let candidates: Candidate[] = []
      let discoveryWarning: string | null = null

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

        const notificationData: Prisma.InputJsonObject = {
          ...notification.data,
          recipientId: recipient.id,
        }

        const clientNotification = await upsertClientNotification({
          tx,
          clientId: candidate.clientId,
          eventKey: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
          title: notification.title,
          body: notification.body,
          href: notification.href,
          dedupeKey: `last-minute-opening:${plan.opening.id}:client:${candidate.clientId}`,
          data: notificationData,
        })

        await tx.lastMinuteRecipient.update({
          where: { id: recipient.id },
          data: {
            sourceDispatchKey: `client-notification:${clientNotification.id}`,
          },
        })

        createdRecipients += 1
      }

      await tx.lastMinuteTierPlan.update({
        where: { id: plan.id },
        data: {
          processedAt: now,
          lastError: discoveryWarning,
        },
      })

      return {
        status: 'processed' as const,
        createdRecipients,
      }
    })

    return {
      id: plan.id,
      openingId: plan.openingId,
      tier: plan.tier,
      status: result.status,
      createdRecipients: result.createdRecipients,
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to process last-minute tier plan'

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
  const secret = getJobSecret()
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
    console.error('GET /api/internal/jobs/last-minute/process error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/last-minute/process error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}