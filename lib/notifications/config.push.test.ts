// lib/notifications/config.push.test.ts
//
// Config-reader tests for the APNs + FCM push providers.

import { generateKeyPairSync } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  isNotificationProviderConfigError,
  isPushProviderConfigured,
  isUsableApnsAuthKey,
  normalizeApnsAuthKey,
  readApnsConfig,
  readApnsConfigOutcome,
  readFcmConfig,
  requireApnsConfig,
  requireFcmConfig,
  resetApnsAuthKeyCacheForTests,
} from './config'

/**
 * A REAL EC P-256 key, generated per run. The previous fixture here was the
 * string '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', which
 * looks like a PEM and can never sign anything — so these tests passed happily
 * through a production outage in which every APNs push failed on exactly that
 * distinction. Only a key that genuinely parses can prove the reader works.
 */
const REAL_P256_PEM = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey.trim()

function setApnsEnv(authKey: string) {
  process.env.APNS_AUTH_KEY = authKey
  process.env.APNS_KEY_ID = 'KEY123'
  process.env.APNS_TEAM_ID = 'TEAM456'
  process.env.APNS_BUNDLE_ID = 'com.tovis.app'
}

const APNS_VARS = [
  'APNS_AUTH_KEY',
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_BUNDLE_ID',
  'APNS_ENV',
] as const

const FCM_VARS = [
  'FCM_SERVICE_ACCOUNT_JSON',
  'FCM_SERVICE_ACCOUNT',
  'FCM_PROJECT_ID',
  'FIREBASE_PROJECT_ID',
] as const

function clearPushEnv() {
  for (const name of [...APNS_VARS, ...FCM_VARS]) {
    delete process.env[name]
  }
  resetApnsAuthKeyCacheForTests()
}

beforeEach(clearPushEnv)
afterEach(clearPushEnv)

describe('readApnsConfig', () => {
  it('reads a full APNs config (production by default)', () => {
    setApnsEnv(REAL_P256_PEM)

    expect(readApnsConfig()).toEqual({
      provider: NotificationProvider.APNS,
      channel: NotificationChannel.PUSH,
      authKey: REAL_P256_PEM,
      keyId: 'KEY123',
      teamId: 'TEAM456',
      bundleId: 'com.tovis.app',
      production: true,
    })
  })

  it('routes to sandbox when APNS_ENV === sandbox', () => {
    setApnsEnv(REAL_P256_PEM)
    process.env.APNS_ENV = 'sandbox'

    expect(readApnsConfig()?.production).toBe(false)
  })

  it('returns null when any APNs var is missing', () => {
    process.env.APNS_AUTH_KEY = REAL_P256_PEM
    process.env.APNS_KEY_ID = 'KEY123'
    process.env.APNS_TEAM_ID = 'TEAM456'
    // no bundle id
    expect(readApnsConfig()).toBeNull()
    expect(readApnsConfigOutcome().problem).toBe('NOT_CONFIGURED')
  })

  it('requireApnsConfig throws a config error when unconfigured', () => {
    try {
      requireApnsConfig()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isNotificationProviderConfigError(error)).toBe(true)
    }
  })
})

describe('APNs auth key transport mangling', () => {
  // The SAME key, delivered three ways an env var actually mangles it. Each must
  // normalise back to byte-identical PEM — that is the A/B proof: only the
  // transport differs, so a pass cannot come from anything else.
  const cases: { name: string; encode: (pem: string) => string }[] = [
    { name: 'raw PEM', encode: (pem) => pem },
    { name: 'escaped newlines', encode: (pem) => pem.replace(/\n/g, '\\n') },
    {
      name: 'base64-wrapped PEM',
      encode: (pem) => Buffer.from(pem, 'utf8').toString('base64'),
    },
    { name: 'wrapped in double quotes', encode: (pem) => `"${pem}"` },
    {
      name: 'escaped newlines inside quotes',
      encode: (pem) => `"${pem.replace(/\n/g, '\\n')}"`,
    },
    { name: 'CRLF line endings', encode: (pem) => pem.replace(/\n/g, '\r\n') },
  ]

  for (const { name, encode } of cases) {
    it(`normalises ${name} back to usable PEM`, () => {
      const normalized = normalizeApnsAuthKey(encode(REAL_P256_PEM))

      expect(normalized).toBe(REAL_P256_PEM)
      expect(isUsableApnsAuthKey(normalized)).toBe(true)
    })

    it(`readApnsConfig accepts ${name}`, () => {
      setApnsEnv(encode(REAL_P256_PEM))

      expect(readApnsConfig()?.authKey).toBe(REAL_P256_PEM)
    })
  }
})

describe('APNs invalid private key', () => {
  // The production failure: all four vars present, key unusable. Every push was
  // enqueued, failed at the ES256 signer, and retried until it died — silently.
  const unusable = [
    { name: 'PEM-shaped but not a key', value: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' },
    { name: 'arbitrary string', value: 'not-a-key' },
    { name: 'truncated PEM', value: REAL_P256_PEM.slice(0, 60) },
  ]

  for (const { name, value } of unusable) {
    it(`rejects ${name}`, () => {
      setApnsEnv(value)

      expect(readApnsConfig()).toBeNull()
      expect(readApnsConfigOutcome().problem).toBe('INVALID_PRIVATE_KEY')
    })
  }

  it('rejects an RSA key — APNs requires EC/ES256', () => {
    const rsa = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey

    expect(isUsableApnsAuthKey(rsa)).toBe(false)
  })

  it('reports push as UNCONFIGURED so no un-sendable rows are enqueued', () => {
    setApnsEnv('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')

    // The whole point: a broken key must not look like a working provider.
    expect(isPushProviderConfigured()).toBe(false)
  })

  it('reports push as configured once the key is real', () => {
    setApnsEnv(REAL_P256_PEM)

    expect(isPushProviderConfigured()).toBe(true)
  })

  it('requireApnsConfig throws APNS_INVALID_PRIVATE_KEY, not NOT_CONFIGURED', () => {
    setApnsEnv('not-a-key')

    try {
      requireApnsConfig()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isNotificationProviderConfigError(error)).toBe(true)
      expect(
        isNotificationProviderConfigError(error) ? error.code : null,
      ).toBe('APNS_INVALID_PRIVATE_KEY')
    }
  })
})

describe('readFcmConfig', () => {
  it('parses the service account JSON + project id', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: 'service_account',
      client_email: 'svc@example.iam.gserviceaccount.com',
    })
    process.env.FCM_PROJECT_ID = 'tovis-prod'

    const config = readFcmConfig()

    expect(config?.provider).toBe(NotificationProvider.FCM)
    expect(config?.channel).toBe(NotificationChannel.PUSH)
    expect(config?.projectId).toBe('tovis-prod')
    expect(config?.serviceAccount).toEqual({
      type: 'service_account',
      client_email: 'svc@example.iam.gserviceaccount.com',
    })
  })

  it('returns null when the service account JSON is malformed', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '{ not valid json'
    process.env.FCM_PROJECT_ID = 'tovis-prod'

    expect(readFcmConfig()).toBeNull()
  })

  it('returns null when project id is missing', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'x' })
    expect(readFcmConfig()).toBeNull()
  })

  it('returns null for a JSON array (not an object)', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '[1,2,3]'
    process.env.FCM_PROJECT_ID = 'tovis-prod'
    expect(readFcmConfig()).toBeNull()
  })

  it('requireFcmConfig throws a config error when unconfigured', () => {
    try {
      requireFcmConfig()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isNotificationProviderConfigError(error)).toBe(true)
    }
  })
})
