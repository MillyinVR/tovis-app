// lib/notifications/config.ts

import { NotificationChannel, NotificationProvider } from '@prisma/client'

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

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

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