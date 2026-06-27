// lib/notifications/config.ts

import { NotificationChannel, NotificationProvider } from '@prisma/client'

import { readOptionalEnv as readEnv } from '@/lib/env'

export type NotificationProviderConfigErrorCode =
  | 'TWILIO_SMS_NOT_CONFIGURED'
  | 'POSTMARK_EMAIL_NOT_CONFIGURED'
  | 'NOTIFICATION_CHANNEL_UNSUPPORTED'

export class NotificationProviderConfigError extends Error {
  readonly code: NotificationProviderConfigErrorCode

  constructor(code: NotificationProviderConfigErrorCode, message: string) {
    super(message)
    this.name = 'NotificationProviderConfigError'
    this.code = code
  }
}

export type TwilioSmsConfig = {
  provider: typeof NotificationProvider.TWILIO
  channel: typeof NotificationChannel.SMS
  accountSid: string
  authToken: string
  fromNumber: string
}

export type PostmarkEmailConfig = {
  provider: typeof NotificationProvider.POSTMARK
  channel: typeof NotificationChannel.EMAIL
  serverToken: string
  fromEmail: string
  messageStream: string | null
}

export type NotificationProviderConfig =
  | TwilioSmsConfig
  | PostmarkEmailConfig

function readFirstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = readEnv(name)
    if (value) return value
  }

  return null
}

export function readTwilioSmsConfig(): TwilioSmsConfig | null {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')

  const fromNumber = readFirstEnv([
    'TWILIO_NOTIFICATION_FROM_NUMBER',
    'TWILIO_TOLL_FREE_NUMBER',
    'TWILIO_FROM_NUMBER',
  ])

  if (!accountSid || !authToken || !fromNumber) {
    return null
  }

  return {
    provider: NotificationProvider.TWILIO,
    channel: NotificationChannel.SMS,
    accountSid,
    authToken,
    fromNumber,
  }
}

export function requireTwilioSmsConfig(): TwilioSmsConfig {
  const config = readTwilioSmsConfig()

  if (!config) {
    throw new NotificationProviderConfigError(
      'TWILIO_SMS_NOT_CONFIGURED',
      'Twilio SMS notifications are not configured.',
    )
  }

  return config
}

/**
 * Whether a Twilio SMS provider is configured for notification dispatch.
 *
 * Used as the launch gate for SMS notifications: while this is false, SMS is
 * suppressed at enqueue time (see lib/notifications/dispatch/enqueueDispatch.ts)
 * so notifications fall back to email + in-app instead of piling up failed SMS
 * delivery attempts. It flips to true automatically once credentials are set —
 * no code change required.
 */
export function isTwilioSmsConfigured(): boolean {
  return readTwilioSmsConfig() !== null
}

/**
 * Whether a PUSH provider (APNs and/or FCM) is configured for notification
 * dispatch.
 *
 * PR2a engine-wiring launch gate: PUSH must stay fully inert in production until
 * a later PR (PR2b/PR3) provisions the APNs/FCM credentials and ships the real
 * provider clients. While this returns false, PUSH capability is forced off at
 * enqueue (see lib/notifications/channelPolicy + enqueueDispatch) so NO PUSH
 * delivery rows are ever created — there is nothing that could send them and they
 * would otherwise retry forever.
 *
 * It checks for any push credentials so it flips to true automatically the
 * instant they are set (alongside the provider-client PR) — no code change here.
 * APNs needs an auth key (.p8), key id, team id and bundle id; FCM needs a
 * service-account JSON / project id.
 */
export function isPushProviderConfigured(): boolean {
  const apnsConfigured = Boolean(
    readEnv('APNS_AUTH_KEY') &&
      readEnv('APNS_KEY_ID') &&
      readEnv('APNS_TEAM_ID') &&
      readEnv('APNS_BUNDLE_ID'),
  )

  const fcmConfigured = Boolean(
    readFirstEnv(['FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT']) &&
      readFirstEnv(['FCM_PROJECT_ID', 'FIREBASE_PROJECT_ID']),
  )

  return apnsConfigured || fcmConfigured
}

export function readPostmarkEmailConfig(): PostmarkEmailConfig | null {
  const serverToken = readFirstEnv([
    'POSTMARK_SERVER_TOKEN',
    'POSTMARK_API_TOKEN',
  ])

  const fromEmail = readFirstEnv([
    'POSTMARK_NOTIFICATION_FROM_EMAIL',
    'POSTMARK_FROM_EMAIL',
    'EMAIL_FROM',
  ])

  const messageStream = readFirstEnv([
    'POSTMARK_NOTIFICATION_MESSAGE_STREAM',
    'POSTMARK_MESSAGE_STREAM',
  ])

  if (!serverToken || !fromEmail) {
    return null
  }

  return {
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    serverToken,
    fromEmail,
    messageStream,
  }
}

export function requirePostmarkEmailConfig(): PostmarkEmailConfig {
  const config = readPostmarkEmailConfig()

  if (!config) {
    throw new NotificationProviderConfigError(
      'POSTMARK_EMAIL_NOT_CONFIGURED',
      'Postmark email notifications are not configured.',
    )
  }

  return config
}

export function readNotificationProviderConfigForChannel(
  channel: NotificationChannel,
): NotificationProviderConfig | null {
  if (channel === NotificationChannel.SMS) {
    return readTwilioSmsConfig()
  }

  if (channel === NotificationChannel.EMAIL) {
    return readPostmarkEmailConfig()
  }

  return null
}

export function requireNotificationProviderConfigForChannel(
  channel: NotificationChannel,
): NotificationProviderConfig {
  if (channel === NotificationChannel.SMS) {
    return requireTwilioSmsConfig()
  }

  if (channel === NotificationChannel.EMAIL) {
    return requirePostmarkEmailConfig()
  }

  throw new NotificationProviderConfigError(
    'NOTIFICATION_CHANNEL_UNSUPPORTED',
    `Notification channel ${channel} is not supported.`,
  )
}

export function getNotificationProviderForChannel(
  channel: NotificationChannel,
): NotificationProvider {
  if (channel === NotificationChannel.SMS) {
    return NotificationProvider.TWILIO
  }

  if (channel === NotificationChannel.EMAIL) {
    return NotificationProvider.POSTMARK
  }

  throw new NotificationProviderConfigError(
    'NOTIFICATION_CHANNEL_UNSUPPORTED',
    `Notification channel ${channel} is not supported.`,
  )
}

export function isNotificationProviderConfigError(
  error: unknown,
): error is NotificationProviderConfigError {
  return error instanceof NotificationProviderConfigError
}