// lib/notifications/config.push.test.ts
//
// Config-reader tests for the APNs + FCM push providers.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import {
  isNotificationProviderConfigError,
  readApnsConfig,
  readFcmConfig,
  requireApnsConfig,
  requireFcmConfig,
} from './config'

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
}

beforeEach(clearPushEnv)
afterEach(clearPushEnv)

describe('readApnsConfig', () => {
  it('reads a full APNs config (production by default)', () => {
    process.env.APNS_AUTH_KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
    process.env.APNS_KEY_ID = 'KEY123'
    process.env.APNS_TEAM_ID = 'TEAM456'
    process.env.APNS_BUNDLE_ID = 'com.tovis.app'

    const config = readApnsConfig()

    expect(config).toEqual({
      provider: NotificationProvider.APNS,
      channel: NotificationChannel.PUSH,
      authKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      keyId: 'KEY123',
      teamId: 'TEAM456',
      bundleId: 'com.tovis.app',
      production: true,
    })
  })

  it('routes to sandbox when APNS_ENV === sandbox', () => {
    process.env.APNS_AUTH_KEY = 'key'
    process.env.APNS_KEY_ID = 'KEY123'
    process.env.APNS_TEAM_ID = 'TEAM456'
    process.env.APNS_BUNDLE_ID = 'com.tovis.app'
    process.env.APNS_ENV = 'sandbox'

    expect(readApnsConfig()?.production).toBe(false)
  })

  it('returns null when any APNs var is missing', () => {
    process.env.APNS_AUTH_KEY = 'key'
    process.env.APNS_KEY_ID = 'KEY123'
    process.env.APNS_TEAM_ID = 'TEAM456'
    // no bundle id
    expect(readApnsConfig()).toBeNull()
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
