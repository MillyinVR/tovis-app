// lib/notifications/socialDigest/runDigest.ts
//
// Orchestrator for the weekly social digest email (social-first C3). Finds pro
// + client recipients with UNREAD social notifications in the window, respects
// each recipient's per-event email preference (the unsubscribe surface), and
// sends ONE Postmark digest per recipient. Reuses the existing email provider
// (lib/notifications/delivery/sendEmail.ts) — no per-notification delivery rows.
//
// Re-nag safety: the window is bounded to `windowDays`, and a weekly cadence
// means an unread item is old enough to fall out of the window before the next
// run — so each item is digested at most once without any new persisted state.
import {
  NotificationChannel,
  NotificationEventKey,
  NotificationProvider,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { getAppUrl } from '@/lib/membership/urls'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'
import { readPostmarkEmailConfig } from '@/lib/notifications/config'
import { createEmailDeliveryProvider } from '@/lib/notifications/delivery/sendEmail'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'
import { TOVIS_ROOT_TENANT_SLUG } from '@/lib/tenant/constants'
import {
  rootTenantContext,
  whiteLabelTenantContext,
  type TenantContext,
} from '@/lib/tenant/context'

import {
  DEFAULT_DIGEST_MAX_RECIPIENTS,
  DEFAULT_DIGEST_TOP_LOOKS,
  DEFAULT_DIGEST_WINDOW_DAYS,
  MAX_DIGEST_MAX_RECIPIENTS,
  MAX_DIGEST_ROWS_PER_RECIPIENT,
  MAX_DIGEST_WINDOW_DAYS,
  MIN_DIGEST_WINDOW_DAYS,
  SOCIAL_DIGEST_EVENT_KEYS,
} from './constants'
import {
  renderSocialDigestEmail,
  type SocialDigestEmailModel,
  type SocialDigestTopLook,
} from './render'
import {
  summarizeDigestRows,
  type DigestNotificationRow,
} from './summary'
import { loadSocialDigestTopLooks } from './topLooks'

type DigestDb = PrismaClient | Prisma.TransactionClient

const DAY_MS = 24 * 60 * 60 * 1000

const PRO_MANAGE_PREFERENCES_PATH = '/pro/notifications/settings'
const CLIENT_MANAGE_PREFERENCES_PATH = '/client/notifications'
const BROWSE_LOOKS_PATH = '/looks'

export type DigestEmailPayload = {
  to: string
  recipientKind: 'PRO' | 'CLIENT'
  recipientId: string
  windowKey: string
  subject: string
  text: string
  html: string
}

export type DigestEmailSender = (
  payload: DigestEmailPayload,
) => Promise<{ ok: boolean }>

export type RunSocialDigestArgs = {
  now?: Date
  windowDays?: number
  maxRecipients?: number
  topLooksLimit?: number
  db?: DigestDb
  /**
   * Injectable for tests. `undefined` → build the Postmark sender from config
   * (null when unconfigured, so the run no-ops). `null` → explicitly disabled.
   */
  sender?: DigestEmailSender | null
}

export type SocialDigestRunResult = {
  emailConfigured: boolean
  windowDays: number
  since: string
  proRecipientsConsidered: number
  clientRecipientsConsidered: number
  sent: number
  skippedNoEmail: number
  skippedNoEnabledEvents: number
  failed: number
}

type PreparedRecipient = {
  recipientKind: 'PRO' | 'CLIENT'
  recipientId: string
  email: string
  greetingName: string | null
  tenantId: string
  tenantSlug: string
  managePreferencesPath: string
  rows: DigestNotificationRow[]
  prefsByKey: Map<NotificationEventKey, boolean>
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function toAbsoluteUrl(appUrl: string, href: string): string {
  const value = href.trim()
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return `${appUrl}${value.startsWith('/') ? value : `/${value}`}`
}

function tenantContextFromRow(tenantId: string, slug: string): TenantContext {
  return slug === TOVIS_ROOT_TENANT_SLUG
    ? rootTenantContext(tenantId)
    : whiteLabelTenantContext({ tenantId, slug })
}

function isEmailEnabledForEvent(
  prefsByKey: Map<NotificationEventKey, boolean>,
  eventKey: NotificationEventKey,
): boolean {
  // No preference row → default ON (schema default emailEnabled = true).
  const value = prefsByKey.get(eventKey)
  return value === undefined ? true : value
}

/** Build the real Postmark-backed sender, or null when email is unconfigured. */
function buildPostmarkDigestSender(): DigestEmailSender | null {
  const config = readPostmarkEmailConfig()
  if (!config) return null

  const provider = createEmailDeliveryProvider({
    apiToken: config.serverToken,
    fromEmail: config.fromEmail,
    messageStream: config.messageStream,
  })

  return async (payload) => {
    const idempotencyKey = `social-digest:${payload.recipientKind}:${payload.recipientId}:${payload.windowKey}`

    const result = await provider.send({
      provider: NotificationProvider.POSTMARK,
      channel: NotificationChannel.EMAIL,
      destination: payload.to,
      deliveryId: idempotencyKey,
      dispatchId: idempotencyKey,
      idempotencyKey,
      attemptCount: 1,
      maxAttempts: 1,
      metadata: {
        kind: 'social_digest',
        recipientKind: payload.recipientKind,
        recipientId: payload.recipientId,
      },
      content: {
        channel: NotificationChannel.EMAIL,
        templateKey: 'social_digest',
        templateVersion: 1,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      },
    })

    return { ok: result.ok }
  }
}

function capRowsPerRecipient(
  rows: DigestNotificationRow[],
): DigestNotificationRow[] {
  return rows.length > MAX_DIGEST_ROWS_PER_RECIPIENT
    ? rows.slice(0, MAX_DIGEST_ROWS_PER_RECIPIENT)
    : rows
}

type CollectedRecipients = {
  recipients: PreparedRecipient[]
  /** Distinct recipients with unread digest activity (pre email-address check). */
  groupCount: number
  /** Recipients dropped because they have no email address on file. */
  skippedNoEmail: number
}

async function collectProRecipients(args: {
  db: DigestDb
  since: Date
  maxRecipients: number
}): Promise<CollectedRecipients> {
  const { db, since, maxRecipients } = args

  const groups = await db.notification.groupBy({
    by: ['professionalId'],
    where: {
      eventKey: { in: [...SOCIAL_DIGEST_EVENT_KEYS] },
      readAt: null,
      archivedAt: null,
      createdAt: { gte: since },
    },
    _count: { professionalId: true },
    orderBy: { _count: { professionalId: 'desc' } },
    take: maxRecipients,
  })

  const proIds = groups.map((group) => group.professionalId)
  if (proIds.length === 0) {
    return { recipients: [], groupCount: 0, skippedNoEmail: 0 }
  }

  const [pros, prefRows, rows] = await Promise.all([
    db.professionalProfile.findMany({
      // Recipient contact lookup by known id — the digest is a platform-operator
      // cron that intentionally reaches pros across every tenant, then scopes
      // each email to that pro's own tenant brand. The explicit cross-tenant
      // opt-out (a no-op filter) documents that intent for the tenant guard.
      where: { id: { in: proIds }, ...platformCrossTenantProVisibilityFilter() },
      select: {
        id: true,
        firstName: true, // pii-plaintext-read-ok: greeting name for the pro's own digest email
        homeTenantId: true,
        homeTenant: { select: { id: true, slug: true } },
        user: { select: { email: true } }, // pii-plaintext-read-ok: recipient address for the pro's own digest email
      },
    }),
    db.professionalNotificationPreference.findMany({
      where: {
        professionalId: { in: proIds },
        eventKey: { in: [...SOCIAL_DIGEST_EVENT_KEYS] },
      },
      select: { professionalId: true, eventKey: true, emailEnabled: true },
    }),
    db.notification.findMany({
      where: {
        professionalId: { in: proIds },
        eventKey: { in: [...SOCIAL_DIGEST_EVENT_KEYS] },
        readAt: null,
        archivedAt: null,
        createdAt: { gte: since },
      },
      select: {
        professionalId: true,
        eventKey: true,
        title: true,
        href: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const prefsById = new Map<string, Map<NotificationEventKey, boolean>>()
  for (const pref of prefRows) {
    const map = prefsById.get(pref.professionalId) ?? new Map()
    map.set(pref.eventKey, pref.emailEnabled)
    prefsById.set(pref.professionalId, map)
  }

  const rowsById = new Map<string, DigestNotificationRow[]>()
  for (const row of rows) {
    const list = rowsById.get(row.professionalId) ?? []
    list.push({
      eventKey: row.eventKey,
      title: row.title,
      href: row.href,
      createdAt: row.createdAt,
    })
    rowsById.set(row.professionalId, list)
  }

  const prepared: PreparedRecipient[] = []
  let skippedNoEmail = 0
  for (const pro of pros) {
    const email = trimToNull(pro.user?.email) // pii-plaintext-read-ok: recipient address for the pro's own digest email
    if (!email) {
      skippedNoEmail += 1
      continue
    }

    prepared.push({
      recipientKind: 'PRO',
      recipientId: pro.id,
      email,
      greetingName: trimToNull(pro.firstName),
      tenantId: pro.homeTenant?.id ?? pro.homeTenantId,
      tenantSlug: pro.homeTenant?.slug ?? '',
      managePreferencesPath: PRO_MANAGE_PREFERENCES_PATH,
      rows: capRowsPerRecipient(rowsById.get(pro.id) ?? []),
      prefsByKey: prefsById.get(pro.id) ?? new Map(),
    })
  }

  return { recipients: prepared, groupCount: proIds.length, skippedNoEmail }
}

async function collectClientRecipients(args: {
  db: DigestDb
  since: Date
  maxRecipients: number
}): Promise<CollectedRecipients> {
  const { db, since, maxRecipients } = args

  const groups = await db.clientNotification.groupBy({
    by: ['clientId'],
    where: {
      eventKey: { in: [...SOCIAL_DIGEST_EVENT_KEYS] },
      readAt: null,
      createdAt: { gte: since },
    },
    _count: { clientId: true },
    orderBy: { _count: { clientId: 'desc' } },
    take: maxRecipients,
  })

  const clientIds = groups.map((group) => group.clientId)
  if (clientIds.length === 0) {
    return { recipients: [], groupCount: 0, skippedNoEmail: 0 }
  }

  const [clients, prefRows, rows] = await Promise.all([
    db.clientProfile.findMany({
      where: { id: { in: clientIds } },
      select: {
        id: true,
        firstName: true, // pii-plaintext-read-ok: greeting name for the client's own digest email
        email: true, // pii-plaintext-read-ok: recipient address for the client's own digest email
        homeTenantId: true,
        homeTenant: { select: { id: true, slug: true } },
      },
    }),
    db.clientNotificationPreference.findMany({
      where: {
        clientId: { in: clientIds },
        eventKey: { in: [...SOCIAL_DIGEST_EVENT_KEYS] },
      },
      select: { clientId: true, eventKey: true, emailEnabled: true },
    }),
    db.clientNotification.findMany({
      where: {
        clientId: { in: clientIds },
        eventKey: { in: [...SOCIAL_DIGEST_EVENT_KEYS] },
        readAt: null,
        createdAt: { gte: since },
      },
      select: {
        clientId: true,
        eventKey: true,
        title: true,
        href: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const prefsById = new Map<string, Map<NotificationEventKey, boolean>>()
  for (const pref of prefRows) {
    const map = prefsById.get(pref.clientId) ?? new Map()
    map.set(pref.eventKey, pref.emailEnabled)
    prefsById.set(pref.clientId, map)
  }

  const rowsById = new Map<string, DigestNotificationRow[]>()
  for (const row of rows) {
    const list = rowsById.get(row.clientId) ?? []
    list.push({
      eventKey: row.eventKey,
      title: row.title,
      href: row.href,
      createdAt: row.createdAt,
    })
    rowsById.set(row.clientId, list)
  }

  const prepared: PreparedRecipient[] = []
  let skippedNoEmail = 0
  for (const client of clients) {
    const email = trimToNull(client.email) // pii-plaintext-read-ok: recipient address for the client's own digest email
    if (!email) {
      skippedNoEmail += 1
      continue
    }

    prepared.push({
      recipientKind: 'CLIENT',
      recipientId: client.id,
      email,
      greetingName: trimToNull(client.firstName),
      tenantId: client.homeTenant?.id ?? client.homeTenantId,
      tenantSlug: client.homeTenant?.slug ?? '',
      managePreferencesPath: CLIENT_MANAGE_PREFERENCES_PATH,
      rows: capRowsPerRecipient(rowsById.get(client.id) ?? []),
      prefsByKey: prefsById.get(client.id) ?? new Map(),
    })
  }

  return { recipients: prepared, groupCount: clientIds.length, skippedNoEmail }
}

/**
 * Run one pass of the social digest. Idempotent-enough for a weekly cron: the
 * window bounding stops the same item being emailed twice across runs.
 */
export async function runSocialDigest(
  args: RunSocialDigestArgs = {},
): Promise<SocialDigestRunResult> {
  const now = args.now ?? new Date()
  const windowDays = clampInt(
    args.windowDays ?? DEFAULT_DIGEST_WINDOW_DAYS,
    MIN_DIGEST_WINDOW_DAYS,
    MAX_DIGEST_WINDOW_DAYS,
  )
  const maxRecipients = clampInt(
    args.maxRecipients ?? DEFAULT_DIGEST_MAX_RECIPIENTS,
    1,
    MAX_DIGEST_MAX_RECIPIENTS,
  )
  const topLooksLimit = clampInt(
    args.topLooksLimit ?? DEFAULT_DIGEST_TOP_LOOKS,
    0,
    24,
  )
  const db = args.db ?? prisma
  const since = new Date(now.getTime() - windowDays * DAY_MS)
  const windowKey = since.toISOString().slice(0, 10)

  const sender =
    args.sender === undefined ? buildPostmarkDigestSender() : args.sender

  const baseResult: SocialDigestRunResult = {
    emailConfigured: sender !== null,
    windowDays,
    since: since.toISOString(),
    proRecipientsConsidered: 0,
    clientRecipientsConsidered: 0,
    sent: 0,
    skippedNoEmail: 0,
    skippedNoEnabledEvents: 0,
    failed: 0,
  }

  if (!sender) {
    // Email is dark (no Postmark creds) — nothing to do, mirror how the push
    // pipeline degrades when APNs is unconfigured.
    return baseResult
  }

  const appUrl = getAppUrl()

  const [proCollected, clientCollected] = await Promise.all([
    collectProRecipients({ db, since, maxRecipients }),
    collectClientRecipients({ db, since, maxRecipients }),
  ])

  const recipients = [
    ...proCollected.recipients,
    ...clientCollected.recipients,
  ]

  // Per-tenant memo: brand name + the tenant's absolutized top-looks module.
  const tenantAssetsCache = new Map<
    string,
    { brandName: string; topLooks: SocialDigestTopLook[] }
  >()

  async function resolveTenantAssets(tenantId: string, tenantSlug: string) {
    const cached = tenantAssetsCache.get(tenantId)
    if (cached) return cached

    const ctx = tenantContextFromRow(tenantId, tenantSlug)
    const brandName = getBrandForTenantContext(ctx).displayName
    const rawTopLooks = await loadSocialDigestTopLooks({
      db,
      tenant: ctx,
      since,
      limit: topLooksLimit,
    })
    const topLooks = rawTopLooks.map((look) => ({
      ...look,
      href: toAbsoluteUrl(appUrl, look.href),
    }))

    const assets = { brandName, topLooks }
    tenantAssetsCache.set(tenantId, assets)
    return assets
  }

  const result: SocialDigestRunResult = {
    ...baseResult,
    proRecipientsConsidered: proCollected.groupCount,
    clientRecipientsConsidered: clientCollected.groupCount,
    skippedNoEmail: proCollected.skippedNoEmail + clientCollected.skippedNoEmail,
  }

  for (const recipient of recipients) {
    const enabledRows = recipient.rows.filter((row) =>
      isEmailEnabledForEvent(recipient.prefsByKey, row.eventKey),
    )

    if (enabledRows.length === 0) {
      result.skippedNoEnabledEvents += 1
      continue
    }

    const summary = summarizeDigestRows(enabledRows)
    const assets = await resolveTenantAssets(
      recipient.tenantId,
      recipient.tenantSlug,
    )

    const model: SocialDigestEmailModel = {
      greetingName: recipient.greetingName,
      summary,
      recent: summary.recent.map((item) => ({
        title: item.title,
        href: toAbsoluteUrl(appUrl, item.href),
      })),
      topLooks: assets.topLooks,
      managePreferencesUrl: toAbsoluteUrl(
        appUrl,
        recipient.managePreferencesPath,
      ),
      browseLooksUrl: toAbsoluteUrl(appUrl, BROWSE_LOOKS_PATH),
    }

    const rendered = renderSocialDigestEmail({
      model,
      brandName: assets.brandName,
    })

    try {
      const sendResult = await sender({
        to: recipient.email,
        recipientKind: recipient.recipientKind,
        recipientId: recipient.recipientId,
        windowKey,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })

      if (sendResult.ok) {
        result.sent += 1
      } else {
        result.failed += 1
      }
    } catch (error) {
      result.failed += 1
      console.error('runSocialDigest: send failed', {
        recipientKind: recipient.recipientKind,
        error: safeError(error),
      })
    }
  }

  return result
}
