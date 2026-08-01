// lib/notifications/config.ts

import { createPrivateKey } from 'node:crypto'

import { NotificationChannel, NotificationProvider } from '@prisma/client'

import { readOptionalEnv as readEnv } from '@/lib/env'

export type NotificationProviderConfigErrorCode =
  | 'TWILIO_SMS_NOT_CONFIGURED'
  | 'POSTMARK_EMAIL_NOT_CONFIGURED'
  | 'APNS_PUSH_NOT_CONFIGURED'
  | 'APNS_INVALID_PRIVATE_KEY'
  | 'FCM_PUSH_NOT_CONFIGURED'
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

export type ApnsConfig = {
  provider: typeof NotificationProvider.APNS
  channel: typeof NotificationChannel.PUSH
  // The .p8 auth key PEM contents (NOT a file path).
  authKey: string
  keyId: string
  teamId: string
  bundleId: string
  // True => api.push.apple.com; false => api.sandbox.push.apple.com.
  production: boolean
}

// A Google service-account JSON, parsed. We only need to hand the whole object
// to google-auth-library as `credentials`, so it's kept as an opaque record
// rather than re-declaring Google's schema here.
export type FcmServiceAccount = Record<string, unknown>

export type FcmConfig = {
  provider: typeof NotificationProvider.FCM
  channel: typeof NotificationChannel.PUSH
  serviceAccount: FcmServiceAccount
  projectId: string
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
 *
 * ⚠️ APNs counts only when its auth key actually PARSES, not merely when the
 * four vars are present. A malformed `.p8` (see normalizeApnsAuthKey) is worse
 * than a missing one: the provider looks configured, PUSH rows get enqueued, and
 * every one of them fails at the signer and retries forever — which is exactly
 * what happened in production, silently, until the delivery table was read by
 * hand. Gating on a parseable key keeps the "never create un-sendable rows"
 * contract above true. The outage is NOT hidden by doing so: the health probe
 * reports the invalid key explicitly (notificationDeliveryHealth).
 */
export function isPushProviderConfigured(): boolean {
  const apnsConfigured = readApnsConfig() !== null

  const fcmConfigured = Boolean(
    readFirstEnv(['FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT']) &&
      readFirstEnv(['FCM_PROJECT_ID', 'FIREBASE_PROJECT_ID']),
  )

  return apnsConfigured || fcmConfigured
}

const PEM_PRIVATE_KEY_HEADER = '-----BEGIN'

/**
 * Normalise an APNs `.p8` auth key into real PEM text.
 *
 * A `.p8` is a multi-line PEM, and env-var transports mangle it in three
 * predictable ways: the newlines survive only as literal `\n` escapes (what
 * pasting into a dashboard field usually produces), the whole PEM gets
 * base64-wrapped to dodge that problem, or the value arrives wrapped in quotes.
 * All three reach the ES256 signer as garbage and fail identically with
 * "Invalid private key provided for algorithm ES256", with nothing to say which
 * one it was. Normalising here means the key works whichever encoding it is
 * stored in, so a correct key can never be defeated by its transport.
 */
export function normalizeApnsAuthKey(raw: string): string {
  let value = raw.trim()

  // Strip one layer of wrapping quotes.
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  if (quoted) {
    value = value.slice(1, -1).trim()
  }

  value = unescapeNewlines(value)

  // Still not PEM? The remaining known encoding is a base64-wrapped whole PEM.
  // Buffer.from(..., 'base64') never throws — it silently drops invalid bytes —
  // so the decode only counts when it actually yields a PEM.
  if (!value.includes(PEM_PRIVATE_KEY_HEADER)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    if (decoded.includes(PEM_PRIVATE_KEY_HEADER)) {
      value = unescapeNewlines(decoded)
    }
  }

  // Canonical line endings for the PEM parser.
  return value.replace(/\r\n/g, '\n').trim()
}

function unescapeNewlines(value: string): string {
  return value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
}

/**
 * Whether a normalised PEM is actually usable to sign APNs JWTs. APNs auth keys
 * are always EC (P-256 / ES256), so an RSA key or a stray certificate is a
 * wrong-file mistake and is rejected here rather than at send time.
 */
export function isUsableApnsAuthKey(pem: string): boolean {
  try {
    return createPrivateKey(pem).asymmetricKeyType === 'ec'
  } catch {
    return false
  }
}

// createPrivateKey is not free and isPushProviderConfigured() runs on every
// enqueue, so memoise per raw value. Env vars are fixed for a process lifetime;
// keying on the raw string keeps tests that mutate process.env honest.
let apnsKeyCache: { raw: string; normalized: string | null } | null = null

function resolveApnsAuthKey(raw: string): string | null {
  if (apnsKeyCache?.raw === raw) return apnsKeyCache.normalized

  const normalized = normalizeApnsAuthKey(raw)
  const usable = isUsableApnsAuthKey(normalized) ? normalized : null

  apnsKeyCache = { raw, normalized: usable }
  return usable
}

/** Test-only: drop the memoised key so a changed env var is re-read. */
export function resetApnsAuthKeyCacheForTests(): void {
  apnsKeyCache = null
}

/**
 * Why APNs is unavailable, for diagnostics. `INVALID_PRIVATE_KEY` is the
 * dangerous one: every credential is present, so the provider *looks*
 * configured, but nothing it signs can ever be accepted. Kept distinct from
 * NOT_CONFIGURED so the health probe can say which.
 */
export type ApnsConfigProblem = 'NOT_CONFIGURED' | 'INVALID_PRIVATE_KEY'

export type ApnsConfigOutcome =
  | { config: ApnsConfig; problem: null }
  | { config: null; problem: ApnsConfigProblem }

export function readApnsConfigOutcome(): ApnsConfigOutcome {
  const rawAuthKey = readEnv('APNS_AUTH_KEY')
  const keyId = readEnv('APNS_KEY_ID')
  const teamId = readEnv('APNS_TEAM_ID')
  const bundleId = readEnv('APNS_BUNDLE_ID')

  if (!rawAuthKey || !keyId || !teamId || !bundleId) {
    return { config: null, problem: 'NOT_CONFIGURED' }
  }

  const authKey = resolveApnsAuthKey(rawAuthKey)
  if (!authKey) {
    return { config: null, problem: 'INVALID_PRIVATE_KEY' }
  }

  // Default to the production APNs host; only the explicit "sandbox" opt-in
  // routes to the development gateway.
  const production = readEnv('APNS_ENV')?.toLowerCase() !== 'sandbox'

  return {
    config: {
      provider: NotificationProvider.APNS,
      channel: NotificationChannel.PUSH,
      authKey,
      keyId,
      teamId,
      bundleId,
      production,
    },
    problem: null,
  }
}

export function readApnsConfig(): ApnsConfig | null {
  return readApnsConfigOutcome().config
}

export function requireApnsConfig(): ApnsConfig {
  const outcome = readApnsConfigOutcome()

  if (outcome.problem === 'INVALID_PRIVATE_KEY') {
    throw new NotificationProviderConfigError(
      'APNS_INVALID_PRIVATE_KEY',
      APNS_INVALID_PRIVATE_KEY_MESSAGE,
    )
  }

  if (!outcome.config) {
    throw new NotificationProviderConfigError(
      'APNS_PUSH_NOT_CONFIGURED',
      'APNs push notifications are not configured.',
    )
  }

  return outcome.config
}

/**
 * Deliberately names the fix, not just the symptom — the raw ES256 error this
 * replaces said nothing about what to do, and cost weeks of dead push.
 */
export const APNS_INVALID_PRIVATE_KEY_MESSAGE =
  'APNS_AUTH_KEY is set but is not a usable EC private key. Re-paste the .p8 file contents (including the BEGIN/END lines); escaped newlines, base64 and surrounding quotes are all handled automatically.'

function parseFcmServiceAccount(raw: string): FcmServiceAccount | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    // A malformed JSON blob is treated as unconfigured rather than throwing, so
    // a bad value degrades to "no FCM provider" instead of crashing the worker.
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  return parsed as FcmServiceAccount
}

export function readFcmConfig(): FcmConfig | null {
  const rawServiceAccount = readFirstEnv([
    'FCM_SERVICE_ACCOUNT_JSON',
    'FCM_SERVICE_ACCOUNT',
  ])
  const projectId = readFirstEnv(['FCM_PROJECT_ID', 'FIREBASE_PROJECT_ID'])

  if (!rawServiceAccount || !projectId) {
    return null
  }

  const serviceAccount = parseFcmServiceAccount(rawServiceAccount)
  if (!serviceAccount) {
    return null
  }

  return {
    provider: NotificationProvider.FCM,
    channel: NotificationChannel.PUSH,
    serviceAccount,
    projectId,
  }
}

export function requireFcmConfig(): FcmConfig {
  const config = readFcmConfig()

  if (!config) {
    throw new NotificationProviderConfigError(
      'FCM_PUSH_NOT_CONFIGURED',
      'FCM push notifications are not configured.',
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