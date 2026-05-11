// app/api/webhooks/postmark/route.ts

import { timingSafeEqual } from 'node:crypto'

import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)

  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null

  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
    const separatorIndex = decoded.indexOf(':')

    if (separatorIndex < 0) return null

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    }
  } catch {
    return null
  }
}

function assertPostmarkAuth(req: Request): boolean {
  const expectedUsername = requiredEnv('POSTMARK_WEBHOOK_USERNAME')
  const expectedPassword = requiredEnv('POSTMARK_WEBHOOK_PASSWORD')
  const parsed = parseBasicAuth(req.headers.get('authorization'))

  if (!parsed) return false

  return (
    safeEqual(parsed.username, expectedUsername) &&
    safeEqual(parsed.password, expectedPassword)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(req: Request) {
  try {
    if (!assertPostmarkAuth(req)) {
      return jsonFail(403, 'Forbidden.')
    }

    const payload: unknown = await req.json().catch(() => null)

    if (!isRecord(payload)) {
      return jsonFail(400, 'Invalid Postmark webhook payload.')
    }

    const recordType = pickString(payload.RecordType)
    const messageId = pickString(payload.MessageID) ?? pickString(payload.MessageId)
    const recipient = pickString(payload.Recipient)
    const email = pickString(payload.Email)

    // Add DB persistence here later if needed.
    console.info('Postmark webhook received', {
      recordType,
      messageId,
      recipient,
      email,
    })

    return jsonOk({
      ok: true,
      received: true,
    })
  } catch (err: unknown) {
    console.error('POST /api/webhooks/postmark error', err)
    return jsonFail(500, 'Failed to process Postmark webhook.')
  }
}