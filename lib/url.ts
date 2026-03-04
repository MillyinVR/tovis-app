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