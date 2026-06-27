// app/api/webhooks/postmark/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),

  safeLogMeta: vi.fn((value: unknown) => value),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
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

function makeBasicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function makePostRequest(args?: {
  authorization?: string
  body?: unknown
  rawBody?: string
}): Request {
  return new Request('http://localhost/api/webhooks/postmark', {
    method: 'POST',
    headers: {
      ...(args?.authorization
        ? { authorization: args.authorization }
        : {}),
      'content-type': 'application/json',
    },
    body:
      args?.rawBody ??
      JSON.stringify(
        args && 'body' in args
          ? args.body
          : {
              RecordType: 'Delivery',
              MessageID: 'postmark_message_1',
              Recipient: 'client@example.com',
              Email: 'client@example.com',
            },
      ),
  })
}

describe('app/api/webhooks/postmark/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.POSTMARK_WEBHOOK_USERNAME = 'postmark_user'
    process.env.POSTMARK_WEBHOOK_PASSWORD = 'postmark_password'

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

    mocks.safeLogMeta.mockImplementation((value: unknown) => value)

    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'NonErrorThrown',
      message: error instanceof Error ? error.message : String(error),
    }))
  })

  afterEach(() => {
    delete process.env.POSTMARK_WEBHOOK_USERNAME
    delete process.env.POSTMARK_WEBHOOK_PASSWORD

    vi.restoreAllMocks()
  })

  it('returns 403 when authorization header is missing', async () => {
    const result = await POST(makePostRequest())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.safeLogMeta).not.toHaveBeenCalled()
  })

  it('returns 403 when basic auth credentials are wrong', async () => {
    const result = await POST(
      makePostRequest({
        authorization: makeBasicAuth('wrong_user', 'wrong_password'),
      }),
    )

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.safeLogMeta).not.toHaveBeenCalled()
  })

  it('returns 400 when payload is not a valid object', async () => {
    const result = await POST(
      makePostRequest({
        authorization: makeBasicAuth('postmark_user', 'postmark_password'),
        body: [],
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid Postmark webhook payload.',
    })

    expect(mocks.safeLogMeta).not.toHaveBeenCalled()
  })

  it('logs sanitized webhook metadata and returns received response', async () => {
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined)

    const safeMeta = {
      recordType: 'Delivery',
      messageId: 'postmark_message_1',
      recipient: '[redacted]',
      email: '[redacted]',
    }

    mocks.safeLogMeta.mockReturnValueOnce(safeMeta)

    const result = await POST(
      makePostRequest({
        authorization: makeBasicAuth('postmark_user', 'postmark_password'),
        body: {
          RecordType: 'Delivery',
          MessageID: 'postmark_message_1',
          Recipient: 'client@example.com',
          Email: 'client@example.com',
        },
      }),
    )

    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      recordType: 'Delivery',
      messageId: 'postmark_message_1',
      recipient: 'c***@example.com',
      email: 'c***@example.com',
    })

    expect(infoSpy).toHaveBeenCalledWith(
      'Postmark webhook received',
      safeMeta,
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      received: true,
    })

    infoSpy.mockRestore()
  })

  it('supports MessageId fallback when MessageID is missing', async () => {
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined)

    const result = await POST(
      makePostRequest({
        authorization: makeBasicAuth('postmark_user', 'postmark_password'),
        body: {
          RecordType: 'Bounce',
          MessageId: 'postmark_message_fallback_1',
          Recipient: 'client@example.com',
        },
      }),
    )

    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      recordType: 'Bounce',
      messageId: 'postmark_message_fallback_1',
      recipient: 'c***@example.com',
      email: null,
    })

    expect(infoSpy).toHaveBeenCalledWith(
      'Postmark webhook received',
      {
        recordType: 'Bounce',
        messageId: 'postmark_message_fallback_1',
        recipient: 'c***@example.com',
        email: null,
      },
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      received: true,
    })

    infoSpy.mockRestore()
  })

  it('logs safe error metadata and returns 500 when env config is missing', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    delete process.env.POSTMARK_WEBHOOK_USERNAME

    const safeThrown = {
      name: 'Error',
      message: 'Missing POSTMARK_WEBHOOK_USERNAME',
    }

    mocks.safeError.mockReturnValueOnce(safeThrown)

    const result = await POST(
      makePostRequest({
        authorization: makeBasicAuth('postmark_user', 'postmark_password'),
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(expect.any(Error))
    expect(errorSpy).toHaveBeenCalledWith(
      'POST /api/webhooks/postmark error',
      {
        error: safeThrown,
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to process Postmark webhook.',
    })

    errorSpy.mockRestore()
  })
})