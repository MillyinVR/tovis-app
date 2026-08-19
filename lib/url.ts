// lib/url.ts
export function withCacheBuster(url: string, cb?: number | null) {
  const s = (url ?? '').trim()
  if (!s) return ''

  const cacheBuster = typeof cb === 'number' && Number.isFinite(cb) ? cb : Date.now()

  try {
    const u = new URL(s)
    u.searchParams.set('v', String(cacheBuster))
    return u.toString()
  } catch {
    const joiner = s.includes('?') ? '&' : '?'
    return `${s}${joiner}v=${encodeURIComponent(String(cacheBuster))}`
  }
}

/**
 * Whether two URLs name the same object, ignoring the query string.
 *
 * 🔴 Exists because `withCacheBuster` above is one-way. A viral request's cover
 * is stored as the promoted attachment's URL with `?v=…` appended, while the
 * attachment's own URL never carries a query (the upload gate refuses one), so
 * `cover === attachment` is FALSE for the very pair that has to match — and the
 * cover would be left pointing at bytes the removal just deleted.
 *
 * Shared rather than written at each site: the server decides whether to clear
 * the cover and the reviewer's UI decides whether to warn first, and the two
 * disagreeing means a warning that never fires or fires wrongly.
 */
export function isSameUrlIgnoringQuery(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const strip = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim()
    if (!trimmed) return null
    const cut = trimmed.split('?')[0] ?? trimmed
    return cut.length > 0 ? cut : null
  }

  const left = strip(a)
  const right = strip(b)

  return left !== null && left === right
}
