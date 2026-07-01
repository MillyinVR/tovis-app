// Shared HTTP Basic Auth check for Postmark webhook endpoints (delivery events
// + inbound receipts). Postmark signs webhook calls with the Basic credentials
// configured on the webhook URL; we compare them in constant time.
import { timingSafeEqual } from 'node:crypto'

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function parseBasicAuth(
  header: string | null,
): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null

  try {
    const decoded = Buffer.from(
      header.slice('Basic '.length),
      'base64',
    ).toString('utf8')
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

/**
 * True when the request carries the configured Postmark Basic credentials.
 * Returns false (caller should 403) when the credentials are missing or the
 * env is unset — never throws, so a misconfig fails closed, not with a 500.
 */
export function assertPostmarkWebhookAuth(req: Request): boolean {
  const expectedUsername = process.env.POSTMARK_WEBHOOK_USERNAME?.trim()
  const expectedPassword = process.env.POSTMARK_WEBHOOK_PASSWORD?.trim()
  if (!expectedUsername || !expectedPassword) return false

  const parsed = parseBasicAuth(req.headers.get('authorization'))
  if (!parsed) return false

  return (
    safeEqual(parsed.username, expectedUsername) &&
    safeEqual(parsed.password, expectedPassword)
  )
}
