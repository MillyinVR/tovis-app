import { NotificationChannel, NotificationEventKey, Prisma } from '@prisma/client'

import { readAppOriginFromEnv } from '@/lib/appUrl'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import type { BookingCalendarLinks } from '@/lib/calendar/bookingInvite'
import type { TenantContext } from '@/lib/tenant/context'

import { type NotificationTemplateKey } from '../eventKeys'

const DEFAULT_TEMPLATE_VERSION = 1
const MAX_EMAIL_SUBJECT = 160
const MAX_SMS_TEXT = 320

const CALENDAR_GOOGLE_LABEL = 'Add to Google Calendar'
const CALENDAR_ICS_LABEL = 'Add to Apple or Outlook calendar'
const CALENDAR_SMS_LABEL = 'Add to calendar'

export type NotificationRenderDispatchLike = {
  eventKey: NotificationEventKey
  title: string
  body: string
  href: string
  payload?: Prisma.JsonValue | null
  // "Add to calendar" links, resolved by the delivery layer for booking
  // notifications (confirm / reschedule / reminder / claim-invite). Absent for
  // every other notification, so the renderer simply formats them when present.
  calendarLinks?: BookingCalendarLinks | null
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

export type RenderedPushNotificationContent = {
  channel: typeof NotificationChannel.PUSH
  templateKey: NotificationTemplateKey
  templateVersion: number
  title: string
  body: string
  // Optional deep link into the app (internal path, same as in-app href).
  href?: string
}

export type RenderedNotificationContent =
  | RenderedInAppNotificationContent
  | RenderedSmsNotificationContent
  | RenderedEmailNotificationContent
  | RenderedPushNotificationContent

export type RenderNotificationContentArgs = {
  channel: NotificationChannel
  templateKey: NotificationTemplateKey
  templateVersion?: number | null
  tenantContext: TenantContext
  dispatch: NotificationRenderDispatchLike
}

type TemplateRendererSet = {
  inApp: (
    dispatch: NotificationRenderDispatchLike,
    brandName: string,
  ) => Omit<RenderedInAppNotificationContent, 'templateKey' | 'templateVersion'>
  sms: (
    dispatch: NotificationRenderDispatchLike,
    brandName: string,
  ) => Omit<RenderedSmsNotificationContent, 'templateKey' | 'templateVersion'>
  email: (
    dispatch: NotificationRenderDispatchLike,
    brandName: string,
  ) => Omit<RenderedEmailNotificationContent, 'templateKey' | 'templateVersion'>
  push: (
    dispatch: NotificationRenderDispatchLike,
    brandName: string,
  ) => Omit<RenderedPushNotificationContent, 'templateKey' | 'templateVersion'>
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

function readAppOrigin(): string {
  const origin = readAppOriginFromEnv()

  if (!origin) {
    throw new Error(
      'renderNotificationContent: missing or invalid APP_URL/NEXT_PUBLIC_APP_URL',
    )
  }

  return origin
}

function buildExternalAppHref(value: unknown): string {
  const href = sanitizeInternalHref(value)
  if (!href) return ''

  return `${readAppOrigin()}${href}`
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

function buildBrandSubject(title: string, brandName: string): string {
  const normalizedTitle = normalizeText(title)
  const subject = normalizedTitle ? `${brandName}: ${normalizedTitle}` : brandName
  return clip(subject, MAX_EMAIL_SUBJECT)
}

function joinSmsParts(parts: Array<string | null | undefined>): string {
  const normalized = parts.map((part) => normalizeText(part)).filter(Boolean)
  return clip(normalized.join(' '), MAX_SMS_TEXT)
}

function buildCalendarTextLines(
  calendarLinks: BookingCalendarLinks | null | undefined,
): string[] {
  if (!calendarLinks) return []

  const lines: string[] = []
  if (calendarLinks.googleUrl) {
    lines.push(`${CALENDAR_GOOGLE_LABEL}: ${calendarLinks.googleUrl}`)
  }
  if (calendarLinks.icsUrl) {
    lines.push(`${CALENDAR_ICS_LABEL}: ${calendarLinks.icsUrl}`)
  }
  return lines
}

function buildEmailText(args: {
  title: string
  body: string
  href: string
  ctaLabel: string
  calendarLinks?: BookingCalendarLinks | null
  brandName: string
}): string {
  const lines = [args.title]

  if (args.body) {
    lines.push('', args.body)
  }

  if (args.href) {
    lines.push('', `${args.ctaLabel}: ${args.href}`)
  }

  const calendarLines = buildCalendarTextLines(args.calendarLinks)
  if (calendarLines.length > 0) {
    lines.push('', ...calendarLines)
  }

  lines.push('', `Sent by ${args.brandName}`)

  return lines.join('\n')
}

function buildCalendarHtmlParagraph(
  calendarLinks: BookingCalendarLinks | null | undefined,
): string {
  if (!calendarLinks) return ''

  const anchors: string[] = []
  if (calendarLinks.googleUrl) {
    anchors.push(
      `<a href="${escapeHtml(calendarLinks.googleUrl)}">${escapeHtml(
        CALENDAR_GOOGLE_LABEL,
      )}</a>`,
    )
  }
  if (calendarLinks.icsUrl) {
    anchors.push(
      `<a href="${escapeHtml(calendarLinks.icsUrl)}">${escapeHtml(
        CALENDAR_ICS_LABEL,
      )}</a>`,
    )
  }

  if (anchors.length === 0) return ''

  return `<p>${anchors.join(' &middot; ')}</p>`
}

function buildEmailHtml(args: {
  title: string
  body: string
  href: string
  ctaLabel: string
  calendarLinks?: BookingCalendarLinks | null
  brandName: string
}): string {
  const safeTitle = escapeHtml(args.title)
  const safeBody = escapeHtml(args.body)
  const safeHref = escapeHtml(args.href)
  const safeCtaLabel = escapeHtml(args.ctaLabel)
  const safeBrand = escapeHtml(args.brandName)

  const bodyParagraph = safeBody ? `<p>${safeBody}</p>` : ''
  const linkParagraph = safeHref
    ? `<p><a href="${safeHref}">${safeCtaLabel}</a></p>`
    : ''
  const calendarParagraph = buildCalendarHtmlParagraph(args.calendarLinks)

  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <body>',
    `    <h1>${safeTitle}</h1>`,
    bodyParagraph ? `    ${bodyParagraph}` : '',
    linkParagraph ? `    ${linkParagraph}` : '',
    calendarParagraph ? `    ${calendarParagraph}` : '',
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

    sms(dispatch, brandName) {
      const title = normalizeText(dispatch.title)
      const body = normalizeText(dispatch.body)
      const href = buildExternalAppHref(dispatch.href)

      // Clip the message body first, then append the calendar link intact — an
      // "add to calendar" URL is worthless if truncated. Prefer the shorter
      // same-origin .ics link (opens Apple/Google/Outlook natively) over the
      // long Google template URL to keep segment count down.
      const base = joinSmsParts([`${brandName}: ${title}`, body, href])
      const calendarUrl =
        dispatch.calendarLinks?.icsUrl ??
        dispatch.calendarLinks?.googleUrl ??
        null

      return {
        channel: NotificationChannel.SMS,
        text: calendarUrl
          ? `${base} ${CALENDAR_SMS_LABEL}: ${calendarUrl}`
          : base,
      }
    },

    email(dispatch, brandName) {
      const title = normalizeText(dispatch.title)
      const body = normalizeText(dispatch.body)
      const href = buildExternalAppHref(dispatch.href)
      const calendarLinks = dispatch.calendarLinks

      return {
        channel: NotificationChannel.EMAIL,
        subject: buildBrandSubject(title, brandName),
        text: buildEmailText({
          title,
          body,
          href,
          ctaLabel,
          calendarLinks,
          brandName,
        }),
        html: buildEmailHtml({
          title,
          body,
          href,
          ctaLabel,
          calendarLinks,
          brandName,
        }),
      }
    },

    push(dispatch) {
      // Push payload mirrors the in-app notification: a short title + body, plus
      // an internal deep-link path the native app resolves on tap. The OS chrome
      // already shows the app/brand, so we don't prefix the title with the brand.
      const href = sanitizeInternalHref(dispatch.href)

      return {
        channel: NotificationChannel.PUSH,
        title: normalizeText(dispatch.title),
        body: normalizeText(dispatch.body),
        ...(href ? { href } : {}),
      }
    },
  }
}

const templateCtaLabels: Record<NotificationTemplateKey, string> = {
  booking_request_created: 'Review booking request',
  booking_confirmed: 'View booking',
  booking_started: 'View booking',
  booking_rescheduled: 'View updated booking',
  booking_cancelled_by_client: 'View cancellation',
  booking_cancelled_by_pro: 'View cancellation',
  booking_cancelled_by_admin: 'View cancellation',
  client_claim_invite: 'View my booking',
  consultation_proposal_sent: 'Review proposal',
  consultation_approved: 'View consultation',
  consultation_rejected: 'View consultation',
  review_received: 'View review',
  review_requested: 'Leave a review',
  appointment_reminder: 'View appointment',
  aftercare_ready: 'View aftercare',
  last_minute_opening_available: 'View opening',
  waitlist_time_offered: 'Confirm your time',
  saved_look_availability_opened: 'View opening',
  event_date_countdown: 'View your board',
  viral_request_approved: 'View request',
  payment_collected: 'View payment',
  payment_action_required: 'Resolve payment',
  payment_confirmation_required: 'Confirm payment',
  payment_refunded: 'View refund',
  no_show_fee_charged: 'View details',
  look_follower_new: 'View your profile',
  client_follow: 'View activity',
  look_commented: 'View comment',
  look_comment_replied: 'View reply',
  look_liked: 'View look',
  look_saved: 'View look',
  look_new_from_followed_pro: 'View look',
  look_milestone: 'View look',
  referral_tap_received: 'View referral',
  referral_confirmed: 'View referral',
  referral_converted: 'View referral',
  message_received: 'View message',
  pro_handle_reservation_expiring: 'Keep your handle',
  admin_verification_review_needed: 'Review verification',
  admin_support_ticket_created: 'View ticket',
  admin_viral_request_pending: 'Review request',
  social_digest: 'View activity',
}

const templateRenderers: Record<NotificationTemplateKey, TemplateRendererSet> = {
  booking_request_created: buildStandardTemplateRenderer(
    templateCtaLabels.booking_request_created,
  ),
  booking_confirmed: buildStandardTemplateRenderer(
    templateCtaLabels.booking_confirmed,
  ),
  booking_started: buildStandardTemplateRenderer(
    templateCtaLabels.booking_started,
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
  review_requested: buildStandardTemplateRenderer(
    templateCtaLabels.review_requested,
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
  waitlist_time_offered: buildStandardTemplateRenderer(
    templateCtaLabels.waitlist_time_offered,
  ),
  saved_look_availability_opened: buildStandardTemplateRenderer(
    templateCtaLabels.saved_look_availability_opened,
  ),
  event_date_countdown: buildStandardTemplateRenderer(
    templateCtaLabels.event_date_countdown,
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
  payment_confirmation_required: buildStandardTemplateRenderer(
    templateCtaLabels.payment_confirmation_required,
  ),
  payment_refunded: buildStandardTemplateRenderer(
    templateCtaLabels.payment_refunded,
  ),
  no_show_fee_charged: buildStandardTemplateRenderer(
    templateCtaLabels.no_show_fee_charged,
  ),
  look_follower_new: buildStandardTemplateRenderer(
    templateCtaLabels.look_follower_new,
  ),
  client_follow: buildStandardTemplateRenderer(
    templateCtaLabels.client_follow,
  ),
  look_commented: buildStandardTemplateRenderer(
    templateCtaLabels.look_commented,
  ),
  look_comment_replied: buildStandardTemplateRenderer(
    templateCtaLabels.look_comment_replied,
  ),
  look_liked: buildStandardTemplateRenderer(
    templateCtaLabels.look_liked,
  ),
  look_saved: buildStandardTemplateRenderer(
    templateCtaLabels.look_saved,
  ),
  look_new_from_followed_pro: buildStandardTemplateRenderer(
    templateCtaLabels.look_new_from_followed_pro,
  ),
  look_milestone: buildStandardTemplateRenderer(
    templateCtaLabels.look_milestone,
  ),
  referral_tap_received: buildStandardTemplateRenderer(
    templateCtaLabels.referral_tap_received,
  ),
  referral_confirmed: buildStandardTemplateRenderer(
    templateCtaLabels.referral_confirmed,
  ),
  referral_converted: buildStandardTemplateRenderer(
    templateCtaLabels.referral_converted,
  ),
  message_received: buildStandardTemplateRenderer(
    templateCtaLabels.message_received,
  ),
  pro_handle_reservation_expiring: buildStandardTemplateRenderer(
    templateCtaLabels.pro_handle_reservation_expiring,
  ),
  admin_verification_review_needed: buildStandardTemplateRenderer(
    templateCtaLabels.admin_verification_review_needed,
  ),
  admin_support_ticket_created: buildStandardTemplateRenderer(
    templateCtaLabels.admin_support_ticket_created,
  ),
  admin_viral_request_pending: buildStandardTemplateRenderer(
    templateCtaLabels.admin_viral_request_pending,
  ),
  // Fallback only — the social digest email renders its own body (see
  // lib/notifications/socialDigest) and never calls this renderer.
  social_digest: buildStandardTemplateRenderer(templateCtaLabels.social_digest),
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
  const brandName = getBrandForTenantContext(args.tenantContext).displayName

  if (args.channel === NotificationChannel.IN_APP) {
    return {
      ...renderer.inApp(args.dispatch, brandName),
      templateKey: args.templateKey,
      templateVersion,
    }
  }

  if (args.channel === NotificationChannel.SMS) {
    return {
      ...renderer.sms(args.dispatch, brandName),
      templateKey: args.templateKey,
      templateVersion,
    }
  }

  if (args.channel === NotificationChannel.PUSH) {
    return {
      ...renderer.push(args.dispatch, brandName),
      templateKey: args.templateKey,
      templateVersion,
    }
  }

  return {
    ...renderer.email(args.dispatch, brandName),
    templateKey: args.templateKey,
    templateVersion,
  }
}