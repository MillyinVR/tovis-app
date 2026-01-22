// app/api/_utils/google.ts

/**
 * Shared Google API helpers.
 * Single source of truth for Google Maps / Places / Timezone calls.
 */

const DEFAULT_TIMEOUT_MS = 8000

export function getGoogleMapsKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY')
  }
  return key
}

/**
 * Safely parse JSON without throwing
 */
export async function safeJson<T = any>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    return {} as T
  }
}

/**
 * Fetch with abort timeout (prevents hung Google requests)
 */
export async function fetchWithTimeout(
  url: string,
  opts?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Clamp Google radius values safely
 */
export function clampGoogleRadiusMeters(v: number): number {
  return Math.max(1, Math.min(200_000, Math.trunc(v)))
}

/**
 * Normalize Google Places API status handling
 */
export function assertGoogleOk(status: string, errorMessage?: string) {
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    throw new Error(errorMessage || `Google status: ${status}`)
  }
}
