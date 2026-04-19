import { NotificationChannel, NotificationEventKey, Prisma } from '@prisma/client'

import { type NotificationTemplateKey } from '../eventKeys'

const DEFAULT_TEMPLATE_VERSION = 1
const BRAND_PREFIX = 'TOVIS'
const MAX_EMAIL_SUBJECT = 160
const MAX_SMS_TEXT = 320

export type NotificationRenderDispatchLike = {
  eventKey: NotificationEventKey
  title: string
  body: string
  href: string
  payload?: Prisma.JsonValue | null
}

export type RenderedInAppNotificationContent = {
  channel: typeof NotificationChannel.IN_APP
  templateKey: NotificationTemplateKey
  templateVersion: number
  title: string
  body: string
  href: string
}

export type RenderedSmsNotificationContent = {
  channel: typeof NotificationChannel.SMS
  templateKey: NotificationTemplateKey
  templateVersion: number
  text: string
}

export type RenderedEmailNotificationContent = {
  channel: typeof NotificationChannel.EMAIL
  templateKey: NotificationTemplateKey
  templateVersion: number
  subject: string
  text: string
  html: string
}

export type RenderedNotificationContent =
  | RenderedInAppNotificationContent
  | RenderedSmsNotificationContent
  | RenderedEmailNotificationContent

export type RenderNotificationContentArgs = {
  channel: NotificationChannel
  templateKey: NotificationTemplateKey
  templateVersion?: number | null
  dispatch: NotificationRenderDispatchLike
}

type TemplateRendererSet = {
  inApp: (dispatch: NotificationRenderDispatchLike) => Omit<
    RenderedInAppNotificationContent,
    'templateKey' | 'templateVersion'
  >
  sms: (dispatch: NotificationRenderDispatchLike) => Omit<
    RenderedSmsNotificationContent,
    'templateKey' | 'templateVersion'
  >
  email: (dispatch: NotificationRenderDispatchLike) => Omit<
    RenderedEmailNotificationContent,
    'templateKey' | 'templateVersion'
  >
}

function normalizeTemplateVersion(value: number | null | undefined): number {
  if (value == null) return DEFAULT_TEMPLATE_VERSION

  if (!Number.isInteger(value) || value < 1) {
    throw new Error('renderNotificationContent: invalid templateVersion')
  }

  if (value !== DEFAULT_TEMPLATE_VERSION) {
    throw new Error(`renderNotificationContent: unsupported templateVersion ${value}`)
  }

  return value
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function sanitizeInternalHref(value: unknown): string {
  const href = typeof value === 'string' ? value.trim() : ''
  if (!href) return ''
  if (!href.startsWith('/')) return ''
  if (href.startsWith('//')) return ''
  return href
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildBrandSubject(title: string): string {
  const normalizedTitle = normalizeText(title)
  const subject = normalizedTitle ? `${BRAND_PREFIX}: ${normalizedTitle}` : BRAND_PREFIX
  return clip(subject, MAX_EMAIL_SUBJECT)
}

function joinSmsParts(parts: Array<string | null | undefined>): string {
  const normalized = parts.map((part) => normalizeText(part)).filter(Boolean)
  return clip(normalized.join(' '), MAX_SMS_TEXT)
}

function buildEmailText(args: {
  title: string
  body: string
  href: string
  ctaLabel: string
}): string {
  const lines = [args.title]

  if (args.body) {
    lines.push('', args.body)
  }

  if (args.href) {
    lines.push('', `${args.ctaLabel}: ${args.href}`)
  }

  lines.push('', `Sent by ${BRAND_PREFIX}`)

  return lines.join('\n')
}

function buildEmailHtml(args: {
  title: string
  body: string
  href: string
  ctaLabel: string
}): string {
  const safeTitle = escapeHtml(args.title)
  const safeBody = escapeHtml(args.body)
  const safeHref = escapeHtml(args.href)
  const safeCtaLabel = escapeHtml(args.ctaLabel)
  const safeBrand = escapeHtml(BRAND_PREFIX)

  const bodyParagraph = safeBody ? `<p>${safeBody}</p>` : ''
  const linkParagraph = safeHref
    ? `<p><a href="${safeHref}">${safeCtaLabel}</a></p>`
    : ''

  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <body>',
    `    <h1>${safeTitle}</h1>`,
    bodyParagraph ? `    ${bodyParagraph}` : '',
    linkParagraph ? `    ${linkParagraph}` : '',
    `    <p>Sent by ${safeBrand}</p>`,
    '  </body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStandardTemplateRenderer(ctaLabel: string): TemplateRendererSet {
  return {
    inApp(dispatch) {
      return {
        channel: NotificationChannel.IN_APP,
        title: normalizeText(dispatch.title),
        body: normalizeText(dispatch.body),
        href: sanitizeInternalHref(dispatch.href),
      }
    },

    sms(dispatch) {
      const title = normalizeText(dispatch.title)
      const body = normalizeText(dispatch.body)
      const href = sanitizeInternalHref(dispatch.href)

      return {
        channel: NotificationChannel.SMS,
        text: joinSmsParts([`${BRAND_PREFIX}: ${title}`, body, href]),
      }
    },

    email(dispatch) {
      const title = normalizeText(dispatch.title)
      const body = normalizeText(dispatch.body)
      const href = sanitizeInternalHref(dispatch.href)

      return {
        channel: NotificationChannel.EMAIL,
        subject: buildBrandSubject(title),
        text: buildEmailText({
          title,
          body,
          href,
          ctaLabel,
        }),
        html: buildEmailHtml({
          title,
          body,
          href,
          ctaLabel,
        }),
      }
    },
  }
}

const templateCtaLabels: Record<NotificationTemplateKey, string> = {
  booking_request_created: 'Review booking request',
  booking_confirmed: 'View booking',
  booking_rescheduled: 'View updated booking',
  booking_cancelled_by_client: 'View cancellation',
  booking_cancelled_by_pro: 'View cancellation',
  booking_cancelled_by_admin: 'View cancellation',
  client_claim_invite: 'Claim your profile',
  consultation_proposal_sent: 'Review proposal',
  consultation_approved: 'View consultation',
  consultation_rejected: 'View consultation',
  review_received: 'View review',
  appointment_reminder: 'View appointment',
  aftercare_ready: 'View aftercare',
  last_minute_opening_available: 'View opening',
  viral_request_approved: 'View request',
  payment_collected: 'View payment',
  payment_action_required: 'Resolve payment',
}

const templateRenderers: Record<NotificationTemplateKey, TemplateRendererSet> = {
  booking_request_created: buildStandardTemplateRenderer(
    templateCtaLabels.booking_request_created,
  ),
  booking_confirmed: buildStandardTemplateRenderer(
    templateCtaLabels.booking_confirmed,
  ),
  booking_rescheduled: buildStandardTemplateRenderer(
    templateCtaLabels.booking_rescheduled,
  ),
  booking_cancelled_by_client: buildStandardTemplateRenderer(
    templateCtaLabels.booking_cancelled_by_client,
  ),
  booking_cancelled_by_pro: buildStandardTemplateRenderer(
    templateCtaLabels.booking_cancelled_by_pro,
  ),
  booking_cancelled_by_admin: buildStandardTemplateRenderer(
    templateCtaLabels.booking_cancelled_by_admin,
  ),
  client_claim_invite: buildStandardTemplateRenderer(
    templateCtaLabels.client_claim_invite,
  ),
  consultation_proposal_sent: buildStandardTemplateRenderer(
    templateCtaLabels.consultation_proposal_sent,
  ),
  consultation_approved: buildStandardTemplateRenderer(
    templateCtaLabels.consultation_approved,
  ),
  consultation_rejected: buildStandardTemplateRenderer(
    templateCtaLabels.consultation_rejected,
  ),
  review_received: buildStandardTemplateRenderer(
    templateCtaLabels.review_received,
  ),
  appointment_reminder: buildStandardTemplateRenderer(
    templateCtaLabels.appointment_reminder,
  ),
  aftercare_ready: buildStandardTemplateRenderer(
    templateCtaLabels.aftercare_ready,
  ),
  last_minute_opening_available: buildStandardTemplateRenderer(
    templateCtaLabels.last_minute_opening_available,
  ),
  viral_request_approved: buildStandardTemplateRenderer(
    templateCtaLabels.viral_request_approved,
  ),
  payment_collected: buildStandardTemplateRenderer(
    templateCtaLabels.payment_collected,
  ),
  payment_action_required: buildStandardTemplateRenderer(
    templateCtaLabels.payment_action_required,
  ),
}

function getTemplateRenderer(templateKey: NotificationTemplateKey): TemplateRendererSet {
  const renderer = templateRenderers[templateKey]

  if (!renderer) {
    throw new Error(
      `renderNotificationContent: missing renderer for templateKey ${templateKey}`,
    )
  }

  return renderer
}

export function renderNotificationContent(
  args: RenderNotificationContentArgs,
): RenderedNotificationContent {
  const templateVersion = normalizeTemplateVersion(args.templateVersion)
  const renderer = getTemplateRenderer(args.templateKey)

  if (args.channel === NotificationChannel.IN_APP) {
    return {
      ...renderer.inApp(args.dispatch),
      templateKey: args.templateKey,
      templateVersion,
    }
  }

  if (args.channel === NotificationChannel.SMS) {
    return {
      ...renderer.sms(args.dispatch),
      templateKey: args.templateKey,
      templateVersion,
    }
  }

  return {
    ...renderer.email(args.dispatch),
    templateKey: args.templateKey,
    templateVersion,
  }
}