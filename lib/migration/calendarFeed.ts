// lib/migration/calendarFeed.ts
//
// Fetch a pro-supplied read-only calendar feed URL server-side, with SSRF
// guards, so the calendar import can pull an .ics from a URL (e.g. a Google /
// Vagaro "subscribe" link) instead of a file upload. The pure URL/IP classifiers
// are exported + unit-tested; the network orchestration re-validates every
// redirect hop and caps time + size.
//
// Residual caveat: DNS rebinding (resolve-check then a second resolve at connect
// time) is not fully mitigated here. Acceptable for v1 — the action is
// pro-authenticated and the inputs are public calendar feeds — and documented.

import { lookup } from 'node:dns/promises'

const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_REDIRECTS = 3

export type FetchCalendarFeedResult =
  | { ok: true; ics: string }
  | { ok: false; code: 'INVALID_URL' | 'BLOCKED' | 'UNREACHABLE' | 'TOO_LARGE'; error: string }

// Accept https and webcal (a calendar-subscription scheme that is really https).
// Everything else (http, file, ftp, data, …) is rejected.
export function normalizeFeedUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let candidate = raw.trim()
  if (/^webcal:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^webcal:\/\//i, 'https://')
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return url
}

function ipv4ToParts(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (nums.some((n) => n < 0 || n > 255)) return null
  return nums
}

function isPrivateIpv4(ip: string): boolean {
  const p = ipv4ToParts(ip)
  if (!p) return false
  const [a, b] = [p[0] ?? 0, p[1] ?? 0]
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a >= 224) return true // multicast + reserved + broadcast
  return false
}

// Classify a resolved address as private/loopback/link-local/etc. Conservative:
// anything not clearly public is treated as private (blocked).
export function isPrivateIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase()
  if (!addr) return true

  if (addr.includes('.') && !addr.includes(':')) return isPrivateIpv4(addr)

  // IPv6
  if (addr === '::1' || addr === '::') return true
  // IPv4-mapped (::ffff:a.b.c.d) — classify the embedded IPv4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped && mapped[1]) return isPrivateIpv4(mapped[1])
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true // fe80::/10 link-local
  }
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // fc00::/7 unique-local
  if (addr.startsWith('ff')) return true // multicast
  return false
}

async function hostResolvesToPublicAddress(hostname: string): Promise<boolean> {
  // A literal IP host bypasses DNS; classify it directly.
  if (isPrivateIp(hostname)) return false
  try {
    const addresses = await lookup(hostname, { all: true })
    if (addresses.length === 0) return false
    return addresses.every((a) => !isPrivateIp(a.address))
  } catch {
    return false
  }
}

async function readCappedText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null

  const body = response.body
  if (!body) return await response.text()

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > MAX_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8')
}

export async function fetchCalendarFeed(rawUrl: unknown): Promise<FetchCalendarFeedResult> {
  let current = normalizeFeedUrl(rawUrl)
  if (!current) {
    return { ok: false, code: 'INVALID_URL', error: 'Enter a valid https calendar feed URL.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await hostResolvesToPublicAddress(current.hostname))) {
        return { ok: false, code: 'BLOCKED', error: 'That calendar URL is not allowed.' }
      }

      let response: Response
      try {
        response = await fetch(current.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'text/calendar, text/plain, */*' },
        })
      } catch {
        return { ok: false, code: 'UNREACHABLE', error: 'We could not reach that calendar URL.' }
      }

      // Re-validate every redirect target against the SSRF guard.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        const next = location ? normalizeFeedUrl(location) : null
        if (!next) {
          return { ok: false, code: 'BLOCKED', error: 'That calendar URL redirected somewhere we cannot follow.' }
        }
        current = next
        continue
      }

      if (!response.ok) {
        return { ok: false, code: 'UNREACHABLE', error: 'We could not read that calendar URL.' }
      }

      const text = await readCappedText(response)
      if (text === null) {
        return { ok: false, code: 'TOO_LARGE', error: 'That calendar file is too large to import.' }
      }
      return { ok: true, ics: text }
    }
    return { ok: false, code: 'UNREACHABLE', error: 'That calendar URL has too many redirects.' }
  } finally {
    clearTimeout(timer)
  }
}
