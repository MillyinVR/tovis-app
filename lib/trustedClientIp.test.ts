import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockNextHeaders = vi.hoisted(() => vi.fn(async () => new Headers()))
const mockCaptureMessage = vi.hoisted(() => vi.fn())
const mockScopeSetLevel = vi.hoisted(() => vi.fn())
const mockScopeSetTag = vi.hoisted(() => vi.fn())

const mockWithScope = vi.hoisted(
  () =>
    vi.fn(
      (
        callback: (scope: {
          setLevel: (level: string) => void
          setTag: (key: string, value: string) => void
        }) => void,
      ) => {
        callback({
          setLevel: mockScopeSetLevel,
          setTag: mockScopeSetTag,
        })
      },
    ),
)

vi.mock('next/headers', () => ({
  headers: mockNextHeaders,
}))

vi.mock('@sentry/nextjs', () => ({
  withScope: mockWithScope,
  captureMessage: mockCaptureMessage,
}))

const ORIGINAL_ENV = { ...process.env }
const GLOBAL_KEYS = [
  '__tovisTrustedIpHeaderMissingLogged',
  '__tovisTrustedIpHeaderMissingSentryCaptured',
] as const

async function loadSubject() {
  vi.resetModules()
  return await import('./trustedClientIp')
}

function setNodeEnv(value: 'development' | 'production' | 'test') {
  process.env = {
    ...process.env,
    NODE_ENV: value,
  }
}

function clearTrustedIpGlobals() {
  const g = globalThis as Record<string, unknown>
  for (const key of GLOBAL_KEYS) {
    delete g[key]
  }
}

function makeRequest(headersInit: HeadersInit): Request {
  return new Request('https://tovis.app/api/test', { headers: headersInit })
}

describe('lib/trustedClientIp', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    mockNextHeaders.mockClear()
    mockCaptureMessage.mockClear()
    mockScopeSetLevel.mockClear()
    mockScopeSetTag.mockClear()
    mockWithScope.mockClear()
    clearTrustedIpGlobals()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    clearTrustedIpGlobals()
    vi.restoreAllMocks()
  })

  it('logs once and captures a fatal Sentry message in production when AUTH_TRUSTED_IP_HEADER is unset', async () => {
    setNodeEnv('production')
    delete process.env.AUTH_TRUSTED_IP_HEADER

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const { getTrustedClientIpFromRequest } = await loadSubject()

    expect(
      getTrustedClientIpFromRequest(
        makeRequest({
          'x-forwarded-for': '203.0.113.10',
        }),
      ),
    ).toBeNull()

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      '"event":"trusted_ip_header_missing"',
    )
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      '"level":"error"',
    )

    expect(mockWithScope).toHaveBeenCalledTimes(1)
    expect(mockScopeSetLevel).toHaveBeenCalledWith('fatal')
    expect(mockScopeSetTag).toHaveBeenCalledWith(
      'auth.event',
      'trusted_ip_header_missing',
    )
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'AUTH_TRUSTED_IP_HEADER is not set in production',
    )

    await loadSubject()

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
  })

  it('uses the configured trusted header in production without logging when AUTH_TRUSTED_IP_HEADER is set', async () => {
    setNodeEnv('production')
    process.env.AUTH_TRUSTED_IP_HEADER = 'x-vercel-forwarded-for'

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const { getTrustedClientIpFromRequest } = await loadSubject()

    expect(
      getTrustedClientIpFromRequest(
        makeRequest({
          'x-vercel-forwarded-for': '198.51.100.10, 198.51.100.11',
          'x-forwarded-for': '203.0.113.10',
        }),
      ),
    ).toBe('198.51.100.10')

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(mockWithScope).not.toHaveBeenCalled()
    expect(mockCaptureMessage).not.toHaveBeenCalled()
  })

  it('preserves development fallback behavior when AUTH_TRUSTED_IP_HEADER is unset', async () => {
    setNodeEnv('development')
    delete process.env.AUTH_TRUSTED_IP_HEADER

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const { getTrustedClientIpFromRequest } = await loadSubject()

    expect(
      getTrustedClientIpFromRequest(
        makeRequest({
          'x-forwarded-for': '203.0.113.30, 203.0.113.31',
        }),
      ),
    ).toBe('203.0.113.30')

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(mockWithScope).not.toHaveBeenCalled()
    expect(mockCaptureMessage).not.toHaveBeenCalled()
  })
})