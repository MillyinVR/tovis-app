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