// lib/http.ts
import { isRecord, type UnknownRecord } from '@/lib/guards'

export async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
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