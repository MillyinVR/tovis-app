// app/(main)/booking/AvailabilityDrawer/utils/safeJson.ts

function isJsonContentType(ct: string | null) {
  if (!ct) return false
  const s = ct.toLowerCase()
  return s.includes('application/json') || s.includes('+json')
}

/**
 * Safe JSON reader:
 * - returns `null` for non-JSON or empty bodies
 * - returns `null` if JSON.parse fails
 * - never returns `{}` just to make callers feel better
 */
export async function safeJson(res: Response): Promise<unknown | null> {
  try {
    const ct = res.headers.get('content-type')
    if (!isJsonContentType(ct)) {
      // Some endpoints might still return JSON without the header, but that's a server bug.
      // We intentionally don't guess here.
      return null
    }

    const text = await res.text()
    if (!text.trim()) return null

    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}