// app/api/internal/jobs/notifications/health/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInternalJobSecret: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  evaluateNotificationDeliveryHealth: vi.fn(),
  captureScheduledJobException: vi.fn(),
  sentryCaptureMessage: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...(data as object) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/app/api/_utils/auth/internalJob', () => ({
  getInternalJobSecret: mocks.getInternalJobSecret,
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}))

vi.mock('@/lib/notifications/delivery/notificationDeliveryHealth', () => ({
  evaluateNotificationDeliveryHealth: mocks.evaluateNotificationDeliveryHealth,
}))

vi.mock('@/lib/observability/scheduledJobEvents', () => ({
  captureScheduledJobException: mocks.captureScheduledJobException,
}))

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: unknown) => void) =>
    fn({
      setLevel: vi.fn(),
      setTag: vi.fn(),
      setContext: vi.fn(),
    }),
  captureMessage: mocks.sentryCaptureMessage,
}))

import { GET, POST } from './route'

function req() {
  return new Request('http://localhost/api/internal/jobs/notifications/health')
}

const HEALTHY = {
  healthy: true,
  windowMinutes: 15,
  stuckCount: 0,
  failedFinalCount: 0,
  failedRetryableCount: 0,
  credentialRejectedCount: 0,
  countsByStatus: {},
  topErrorCodes: [],
  providerConfigIssues: [],
  reasons: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getInternalJobSecret.mockReturnValue('job-secret')
  mocks.isAuthorizedJobRequest.mockReturnValue(true)
  mocks.evaluateNotificationDeliveryHealth.mockResolvedValue(HEALTHY)
})

describe('the notification delivery-health probe endpoint', () => {
  it('refuses an unauthorized caller WITHOUT probing', async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.evaluateNotificationDeliveryHealth).not.toHaveBeenCalled()
  })

  it('returns the snapshot and raises nothing while the queue is healthy', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(mocks.sentryCaptureMessage).not.toHaveBeenCalled()
    expect(mocks.captureScheduledJobException).not.toHaveBeenCalled()
  })

  it('alerts when the queue is degraded', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.evaluateNotificationDeliveryHealth.mockResolvedValueOnce({
      ...HEALTHY,
      healthy: false,
      stuckCount: 12,
      reasons: ['stuck'],
    })

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(mocks.sentryCaptureMessage).toHaveBeenCalledWith(
      'Notification delivery health degraded',
    )

    consoleErrorSpy.mockRestore()
  })

  // The one that matters. This job IS the alarm for the whole delivery queue —
  // notifications/process runs every minute and is deliberately left
  // console-only BECAUSE this probe watches the queue it drains. So when the
  // probe itself throws, every downstream signal keeps looking healthy
  // precisely because nothing is measuring it any more. Its own console line
  // reaches Sentry only when SENTRY_ENABLE_LOGS is on, and that is off by
  // default as a PII control — which would leave the watchdog's failure on the
  // silent channel, the exact shape of the warnOnDivergentCronSecrets finding.
  it.each(['GET', 'POST'] as const)(
    '%s captures its OWN failure to Sentry, not just the console',
    async (method) => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      const boom = new Error('probe query timed out')
      mocks.evaluateNotificationDeliveryHealth.mockRejectedValueOnce(boom)

      const handler = method === 'GET' ? GET : POST
      const res = await handler(req())

      expect(res.status).toBe(500)
      expect(mocks.captureScheduledJobException).toHaveBeenCalledWith({
        error: boom,
        job: '/api/internal/jobs/notifications/health',
        event: 'NOTIFICATION_DELIVERY_HEALTH_PROBE_ERROR',
      })

      consoleErrorSpy.mockRestore()
    },
  )
})
