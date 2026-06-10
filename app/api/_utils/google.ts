// app/api/_utils/google.ts

/**
 * Shared Google API helpers.
 * Single source of truth for Google Maps / Places / Timezone calls.
 */

const DEFAULT_TIMEOUT_MS = 8000
const MIN_GOOGLE_RADIUS_METERS = 1
const MAX_GOOGLE_RADIUS_METERS = 200_000

export function getGoogleMapsKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim()

  if (!key) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY')
  }

  return key
}

/**
 * Safely parse JSON without throwing.
 *
 * Default is `unknown` on purpose:
 * callers should narrow the response shape instead of letting `any`
 * leak through the codebase like a tiny haunted fog machine.
 */
export async function safeJson<T = unknown>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    return {} as T
  }
}

/**
 * Fetch with abort timeout.
 *
 * AbortController.signal is passed into fetch so the controller can abort
 * the request if Google hangs or takes too long.
 */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Clamp Google radius values safely.
 */
export function clampGoogleRadiusMeters(value: number): number {
  if (!Number.isFinite(value)) return MIN_GOOGLE_RADIUS_METERS

  return Math.max(
    MIN_GOOGLE_RADIUS_METERS,
    Math.min(MAX_GOOGLE_RADIUS_METERS, Math.trunc(value)),
  )
}

/**
 * Normalize Google API status handling.
 *
 * OK means usable results.
 * ZERO_RESULTS is not a request failure; it just means Google found nothing.
 */
export function assertGoogleOk(
  status: string,
  errorMessage?: string | null,
): void {
  if (status === 'OK' || status === 'ZERO_RESULTS') return

  throw new Error(errorMessage || `Google status: ${status}`)
}