// lib/http.ts
import { isRecord, type UnknownRecord } from '@/lib/guards'

export async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** Same as safeJson, but guarantees the return is an object (record) or null. */
export async function safeJsonRecord(res: Response): Promise<UnknownRecord | null> {
  const data = await safeJson(res)
  return isRecord(data) ? data : null
}

/** Read a trimmed string field from an unknown payload. */
export function readStringField(data: unknown, key: string): string | null {
  if (!isRecord(data)) return null
  const v = data[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Read a number field from an unknown payload. */
export function readNumberField(data: unknown, key: string): number | null {
  if (!isRecord(data)) return null
  const v = data[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function readErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null
  const e = data.error
  return typeof e === 'string' && e.trim() ? e.trim() : null
}

/** `readErrorMessage` with a fallback, for callers that must render something. */
export function readErrorMessageOr(data: unknown, fallback: string): string {
  return readErrorMessage(data) ?? fallback
}

/**
 * Any error-ish string on the payload: `error` first, then `message`.
 *
 * `error` is the USER-facing copy every API failure carries; `message` is the
 * internal one ("Requested opening is no longer available."). Prefer the string
 * written for a human, and only fall back to the internal one when there is
 * nothing else to show.
 */
export function readAnyErrorMessage(data: unknown): string | null {
  const error = readErrorMessage(data)
  if (error) return error

  if (!isRecord(data)) return null
  const message = data.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

/** `readAnyErrorMessage` with a fallback. */
export function readAnyErrorMessageOr(data: unknown, fallback: string): string {
  return readAnyErrorMessage(data) ?? fallback
}

/**
 * Read a failed Response's `error` field, falling back when the body is absent
 * or unparseable. Consumes the body, so call it once per response.
 */
export async function readResponseErrorMessage(
  res: Response,
  fallback = 'Request failed.',
): Promise<string> {
  return readErrorMessage(await safeJson(res)) ?? fallback
}

export function errorMessageFromUnknown(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof Error && e.message.trim()) return e.message.trim()
  if (isRecord(e)) {
    const msg = e.message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  return fallback
}

export function isOkTrue(data: unknown): data is UnknownRecord & { ok: true } {
  return isRecord(data) && data.ok === true
}

/**
 * True for an aborted fetch/request. Matches by `name === 'AbortError'` rather
 * than `instanceof Error`, since the abort reason can be a DOMException that is
 * not always an Error instance across runtimes.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  )
}

export function safeJsonParse(input: string | null | undefined): unknown | null {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}