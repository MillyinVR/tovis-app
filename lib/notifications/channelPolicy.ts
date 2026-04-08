import {
  NotificationChannel,
  NotificationEventKey,
  NotificationPriority,
  NotificationRecipientKind,
  type ClientNotificationPreference,
  type ProfessionalNotificationPreference,
} from '@prisma/client'

import {
  getDefaultChannelsForRecipient,
  getNotificationEventDefinition,
} from './eventKeys'

export type NotificationPreferenceLike =
  | Pick<
      ProfessionalNotificationPreference,
      | 'inAppEnabled'
      | 'smsEnabled'
      | 'emailEnabled'
      | 'quietHoursStartMinutes'
      | 'quietHoursEndMinutes'
    >
  | Pick<
      ClientNotificationPreference,
      | 'inAppEnabled'
      | 'smsEnabled'
      | 'emailEnabled'
      | 'quietHoursStartMinutes'
      | 'quietHoursEndMinutes'
    >

export type RecipientChannelCapabilities = {
  hasInAppTarget: boolean
  hasSmsDestination: boolean
  hasEmailDestination: boolean
}

export type ChannelSuppressionReason =
  | 'RECIPIENT_UNSUPPORTED'
  | 'CHANNEL_NOT_REQUESTED'
  | 'PREFERENCE_DISABLED'
  | 'MISSING_IN_APP_TARGET'
  | 'MISSING_SMS_DESTINATION'
  | 'MISSING_EMAIL_DESTINATION'
  | 'QUIET_HOURS'

export type ChannelEvaluation = {
  channel: NotificationChannel
  enabled: boolean
  reason: ChannelSuppressionReason | null
}

export type ResolveChannelPolicyArgs = {
  key: NotificationEventKey
  recipientKind: NotificationRecipientKind
  capabilities: RecipientChannelCapabilities
  preference?: NotificationPreferenceLike | null

  /**
   * Optional narrowing input.
   *
   * This can only reduce the default event channels.
   * It never enables a channel that the event definition does not already allow.
   */
  requestedChannels?: readonly NotificationChannel[] | null

  /**
   * Recipient-local minute-of-day (0..1439).
   * Pass this when you want quiet hours enforced.
   *
   * Example:
   * - 0 = 12:00 AM
   * - 60 = 1:00 AM
   * - 780 = 1:00 PM
   */
  recipientLocalMinutes?: number | null

  /**
   * Emergency/manual override for system-internal use only.
   * This bypasses quiet hours only when the event definition allows bypass.
   *
   * It still respects:
   * - event channel support
   * - recipient support
   * - channel capability checks
   * - user preference checks
   *
   * It does NOT bypass missing destinations.
   */
  bypassQuietHours?: boolean
}

export type ResolvedChannelPolicy = {
  key: NotificationEventKey
  recipientKind: NotificationRecipientKind
  priority: NotificationPriority
  templateKey: string
  transactional: boolean
  allowQuietHoursBypass: boolean
  selectedChannels: NotificationChannel[]
  evaluations: ChannelEvaluation[]
}

const ALL_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.EMAIL,
]

function normalizeMinuteOfDay(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  const truncated = Math.trunc(value)
  if (truncated < 0 || truncated > 1439) return null

  return truncated
}

function normalizeRequestedChannels(
  value: readonly NotificationChannel[] | null | undefined,
): NotificationChannel[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  return Array.from(new Set(value))
}

function getCapabilityForChannel(
  channel: NotificationChannel,
  capabilities: RecipientChannelCapabilities,
): boolean {
  if (channel === NotificationChannel.IN_APP) {
    return capabilities.hasInAppTarget
  }

  if (channel === NotificationChannel.SMS) {
    return capabilities.hasSmsDestination
  }

  return capabilities.hasEmailDestination
}

function getMissingCapabilityReason(
  channel: NotificationChannel,
): ChannelSuppressionReason {
  if (channel === NotificationChannel.IN_APP) {
    return 'MISSING_IN_APP_TARGET'
  }

  if (channel === NotificationChannel.SMS) {
    return 'MISSING_SMS_DESTINATION'
  }

  return 'MISSING_EMAIL_DESTINATION'
}

function isPreferenceEnabledForChannel(
  channel: NotificationChannel,
  preference: NotificationPreferenceLike | null | undefined,
): boolean {
  if (!preference) return true

  if (channel === NotificationChannel.IN_APP) {
    return preference.inAppEnabled
  }

  if (channel === NotificationChannel.SMS) {
    return preference.smsEnabled
  }

  return preference.emailEnabled
}

function channelUsesQuietHours(channel: NotificationChannel): boolean {
  return channel === NotificationChannel.SMS || channel === NotificationChannel.EMAIL
}

function isWithinQuietHours(args: {
  quietHoursStartMinutes: number | null
  quietHoursEndMinutes: number | null
  recipientLocalMinutes: number | null
}): boolean {
  const start = normalizeMinuteOfDay(args.quietHoursStartMinutes)
  const end = normalizeMinuteOfDay(args.quietHoursEndMinutes)
  const current = normalizeMinuteOfDay(args.recipientLocalMinutes)

  if (start == null || end == null || current == null) return false

  // Equal values mean "disabled / not configured", not 24-hour suppression.
  if (start === end) return false

  // Same-day range, e.g. 09:00 -> 17:00
  if (start < end) {
    return current >= start && current < end
  }

  // Overnight range, e.g. 22:00 -> 07:00
  return current >= start || current < end
}

function isRequestedChannel(
  channel: NotificationChannel,
  requestedChannels: readonly NotificationChannel[] | null,
): boolean {
  if (!requestedChannels || requestedChannels.length === 0) return true
  return requestedChannels.includes(channel)
}

function shouldBypassQuietHours(args: {
  allowQuietHoursBypass: boolean
  bypassQuietHours: boolean
}): boolean {
  return args.allowQuietHoursBypass && args.bypassQuietHours
}

function shouldApplyQuietHours(args: {
  channel: NotificationChannel
  allowQuietHoursBypass: boolean
  bypassQuietHours: boolean
}): boolean {
  if (!channelUsesQuietHours(args.channel)) {
    return false
  }

  return !shouldBypassQuietHours({
    allowQuietHoursBypass: args.allowQuietHoursBypass,
    bypassQuietHours: args.bypassQuietHours,
  })
}

function buildChannelEvaluation(args: {
  key: NotificationEventKey
  channel: NotificationChannel
  capabilities: RecipientChannelCapabilities
  preference?: NotificationPreferenceLike | null
  requestedChannels: readonly NotificationChannel[] | null
  recipientLocalMinutes: number | null
  bypassQuietHours: boolean
}): ChannelEvaluation {
  if (!isRequestedChannel(args.channel, args.requestedChannels)) {
    return {
      channel: args.channel,
      enabled: false,
      reason: 'CHANNEL_NOT_REQUESTED',
    }
  }

  if (!getCapabilityForChannel(args.channel, args.capabilities)) {
    return {
      channel: args.channel,
      enabled: false,
      reason: getMissingCapabilityReason(args.channel),
    }
  }

  if (!isPreferenceEnabledForChannel(args.channel, args.preference)) {
    return {
      channel: args.channel,
      enabled: false,
      reason: 'PREFERENCE_DISABLED',
    }
  }

  const definition = getNotificationEventDefinition(args.key)

  if (
    shouldApplyQuietHours({
      channel: args.channel,
      allowQuietHoursBypass: definition.allowQuietHoursBypass,
      bypassQuietHours: args.bypassQuietHours,
    }) &&
    isWithinQuietHours({
      quietHoursStartMinutes: args.preference?.quietHoursStartMinutes ?? null,
      quietHoursEndMinutes: args.preference?.quietHoursEndMinutes ?? null,
      recipientLocalMinutes: args.recipientLocalMinutes,
    })
  ) {
    return {
      channel: args.channel,
      enabled: false,
      reason: 'QUIET_HOURS',
    }
  }

  return {
    channel: args.channel,
    enabled: true,
    reason: null,
  }
}

export function getRecipientChannelCapabilities(args: {
  recipientKind: NotificationRecipientKind
  inAppTargetId?: string | null
  phone?: string | null
  phoneVerifiedAt?: Date | null
  email?: string | null
}): RecipientChannelCapabilities {
  const inAppTargetId =
    typeof args.inAppTargetId === 'string' ? args.inAppTargetId.trim() : ''
  const phone = typeof args.phone === 'string' ? args.phone.trim() : ''
  const email = typeof args.email === 'string' ? args.email.trim() : ''

  return {
    hasInAppTarget: inAppTargetId.length > 0,
    hasSmsDestination: phone.length > 0 && Boolean(args.phoneVerifiedAt),
    hasEmailDestination: email.length > 0,
  }
}

export function getRecipientLocalMinutes(args: {
  at: Date
  timeZone?: string | null
}): number | null {
  if (!(args.at instanceof Date) || Number.isNaN(args.at.getTime())) {
    return null
  }

  const timeZone =
    typeof args.timeZone === 'string' && args.timeZone.trim().length > 0
      ? args.timeZone.trim()
      : null

  if (!timeZone) return null

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(args.at)

    const hourPart = parts.find((part) => part.type === 'hour')?.value ?? ''
    const minutePart = parts.find((part) => part.type === 'minute')?.value ?? ''

    const hour = Number.parseInt(hourPart, 10)
    const minute = Number.parseInt(minutePart, 10)

    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null
    }

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null
    }

    return hour * 60 + minute
  } catch {
    return null
  }
}

export function resolveChannelPolicy(
  args: ResolveChannelPolicyArgs,
): ResolvedChannelPolicy {
  const definition = getNotificationEventDefinition(args.key)

  if (!definition.supportedRecipients.includes(args.recipientKind)) {
    return {
      key: args.key,
      recipientKind: args.recipientKind,
      priority: definition.defaultPriority,
      templateKey: definition.templateKey,
      transactional: definition.transactional,
      allowQuietHoursBypass: definition.allowQuietHoursBypass,
      selectedChannels: [],
      evaluations: ALL_CHANNELS.map((channel) => ({
        channel,
        enabled: false,
        reason: 'RECIPIENT_UNSUPPORTED' as const,
      })),
    }
  }

  const defaultChannels = getDefaultChannelsForRecipient({
    key: args.key,
    recipientKind: args.recipientKind,
  })

  const requestedChannels = normalizeRequestedChannels(args.requestedChannels)
  const recipientLocalMinutes = normalizeMinuteOfDay(args.recipientLocalMinutes)
  const bypassQuietHours = args.bypassQuietHours ?? false

  const evaluations = defaultChannels.map((channel) =>
    buildChannelEvaluation({
      key: args.key,
      channel,
      capabilities: args.capabilities,
      preference: args.preference,
      requestedChannels,
      recipientLocalMinutes,
      bypassQuietHours,
    }),
  )

  return {
    key: args.key,
    recipientKind: args.recipientKind,
    priority: definition.defaultPriority,
    templateKey: definition.templateKey,
    transactional: definition.transactional,
    allowQuietHoursBypass: definition.allowQuietHoursBypass,
    selectedChannels: evaluations
      .filter((evaluation) => evaluation.enabled)
      .map((evaluation) => evaluation.channel),
    evaluations,
  }
}

export function selectChannelsForDispatch(
  args: ResolveChannelPolicyArgs,
): NotificationChannel[] {
  return resolveChannelPolicy(args).selectedChannels
}

export function isChannelSelected(args: {
  key: NotificationEventKey
  recipientKind: NotificationRecipientKind
  channel: NotificationChannel
  capabilities: RecipientChannelCapabilities
  preference?: NotificationPreferenceLike | null
  requestedChannels?: readonly NotificationChannel[] | null
  recipientLocalMinutes?: number | null
  bypassQuietHours?: boolean
}): boolean {
  return resolveChannelPolicy({
    key: args.key,
    recipientKind: args.recipientKind,
    capabilities: args.capabilities,
    preference: args.preference,
    requestedChannels: args.requestedChannels,
    recipientLocalMinutes: args.recipientLocalMinutes,
    bypassQuietHours: args.bypassQuietHours,
  }).selectedChannels.includes(args.channel)
}