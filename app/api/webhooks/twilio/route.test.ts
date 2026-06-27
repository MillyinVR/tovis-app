// app/api/webhooks/twilio/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  validateRequest: vi.fn(),
  getTwilioAuthToken: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),

  safeLogMeta: vi.fn((value: unknown) => value),
}))

vi.mock('twilio', () => ({
  validateRequest: mocks.validateRequest,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/twilio', () => ({
  getTwilioAuthToken: mocks.getTwilioAuthToken,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
  safeLogMeta: mocks.safeLogMeta,
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makePostRequest(args?: {
  signature?: string
  body?: URLSearchParams | string
  headers?: Record<string, string>
  url?: string
}): Request {
  const body =
    typeof args?.body === 'string'
      ? args.body
      : (
          args?.body ??
          new URLSearchParams({
            MessageSid: 'SM_message_1',
            MessageStatus: 'delivered',
            To: '+15550001111',
            From: '+15550002222',
          })
        ).toString()

  return new Request(
    args?.url ?? 'http://localhost/api/webhooks/twilio?foo=bar',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': args?.signature ?? 'twilio_signature_1',
        ...(args?.headers ?? {}),
      },
      body,
    },
  )
}

describe('app/api/webhooks/twilio/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.getTwilioAuthToken.mockReturnValue('twilio_auth_token_1')
    mocks.validateRequest.mockReturnValue(true)
    mocks.safeLogMeta.mockImplementation((value: unknown) => value)
    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'NonErrorThrown',
      message: error instanceof Error ? error.message : String(error),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 403 when Twilio signature validation fails', async () => {
    mocks.validateRequest.mockReturnValueOnce(false)

    const result = await POST(makePostRequest())

    expect(mocks.validateRequest).toHaveBeenCalledWith(
      'twilio_auth_token_1',
      'twilio_signature_1',
      'http://localhost/api/webhooks/twilio?foo=bar',
      {
        MessageSid: 'SM_message_1',
        MessageStatus: 'delivered',
        To: '+15550001111',
        From: '+15550002222',
      },
    )

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid Twilio signature.',
    })

    expect(mocks.safeLogMeta).not.toHaveBeenCalled()
  })

  it('uses forwarded proto and host when validating the public request URL', async () => {
    await POST(
      makePostRequest({
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'app.tovis.com',
          host: 'localhost:3000',
        },
      }),
    )

    expect(mocks.validateRequest).toHaveBeenCalledWith(
      'twilio_auth_token_1',
      'twilio_signature_1',
      'https://app.tovis.com/api/webhooks/twilio?foo=bar',
      {
        MessageSid: 'SM_message_1',
        MessageStatus: 'delivered',
        To: '+15550001111',
        From: '+15550002222',
      },
    )
  })

  it('logs sanitized Twilio webhook metadata and returns received response', async () => {
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined)

    const safeMeta = {
      messageSid: 'SM_message_1',
      messageStatus: 'delivered',
      to: '[redacted]',
      from: '[redacted]',
    }

    mocks.safeLogMeta.mockReturnValueOnce(safeMeta)

    const result = await POST(makePostRequest())

    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      messageSid: 'SM_message_1',
      messageStatus: 'delivered',
      to: '***1111',
      from: '***2222',
    })

    expect(infoSpy).toHaveBeenCalledWith('Twilio webhook received', safeMeta)

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      received: true,
    })

    infoSpy.mockRestore()
  })

  it('supports SmsSid and SmsStatus fallback fields', async () => {
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined)

    const safeMeta = {
      messageSid: 'SM_sms_1',
      messageStatus: 'sent',
      to: '[redacted]',
      from: '[redacted]',
    }

    mocks.safeLogMeta.mockReturnValueOnce(safeMeta)

    const result = await POST(
      makePostRequest({
        body: new URLSearchParams({
          SmsSid: 'SM_sms_1',
          SmsStatus: 'sent',
          To: '+15550001111',
          From: '+15550002222',
        }),
      }),
    )

    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      messageSid: 'SM_sms_1',
      messageStatus: 'sent',
      to: '***1111',
      from: '***2222',
    })

    expect(infoSpy).toHaveBeenCalledWith('Twilio webhook received', safeMeta)

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      received: true,
    })

    infoSpy.mockRestore()
  })

  it('logs safe error metadata and returns 500 when auth token lookup throws', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'missing token for tori@example.com secret_123',
    )

    const safeThrown = {
      name: 'Error',
      message: 'missing token for tori@example.com secret_123',
    }

    mocks.getTwilioAuthToken.mockImplementationOnce(() => {
      throw thrown
    })

    mocks.safeError.mockReturnValueOnce(safeThrown)

    const result = await POST(makePostRequest())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(errorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/twilio error',
      {
        error: safeThrown,
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to process Twilio webhook.',
    })

    errorSpy.mockRestore()
  })

  it('logs safe error metadata and returns 500 when signature validation throws', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'twilio validation failed for +15550001111 token secret_123',
    )

    const safeThrown = {
      name: 'Error',
      message: 'twilio validation failed for +15550001111 token secret_123',
    }

    mocks.validateRequest.mockImplementationOnce(() => {
      throw thrown
    })

    mocks.safeError.mockReturnValueOnce(safeThrown)

    const result = await POST(makePostRequest())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(errorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/twilio error',
      {
        error: safeThrown,
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to process Twilio webhook.',
    })

    errorSpy.mockRestore()
  })
})