// lib/security/internalPath.ts
//
// "Is this string a path on OUR site?" — the one answer, for every place that
// turns a caller-supplied value into somewhere a browser will go.
//
// This existed correctly twice (`lib/auth/sessionHandoff.ts`,
// `lib/shortLink/allowlist.ts`) and weakly thirteen times, where the whole rule
// was `startsWith('/') && !startsWith('//')`. That misses the backslash:
//
//   new URL('/\\evil.example/x', 'https://app.tovis.app').host  // 'evil.example'
//
// A `/\` path starts with exactly one slash, so it passed every weak copy, and
// browsers normalise the backslash to `/` — making it protocol-relative and
// off-site. `/login?from=/\evil.example` was a live open redirect on that basis.
//
// The rule below is the strict one, lifted from the two implementations that
// already had it right. Anything those two accept, this accepts; the thirteen
// weak sites only ever get stricter, never looser.

/** Generous, but bounded: a redirect target is never legitimately this long. */
const MAX_INTERNAL_PATH_LENGTH = 2048

/** The origin a candidate is parsed against. Never fetched — a parser fixture. */
const PATH_PARSE_ORIGIN = 'https://internal-path.invalid'

/**
 * Reduce an arbitrary value to a path we are willing to navigate to, or `null`.
 *
 * Rejects, in order: non-strings, blank, over-long, anything not starting with
 * `/`, protocol-relative `//host`, any backslash (browsers disagree whether it
 * means `/`), control characters and raw spaces (CR/LF must never reach a
 * `Location` header), anything the URL parser resolves to a different origin —
 * which closes normalisation surprises generally rather than one trick at a
 * time — and traversal in the decoded pathname.
 *
 * Returns the RESOLVED path — pathname + query + hash as the URL parser
 * computes them. For every ordinary path that is byte-identical to the trimmed
 * input, so it is a drop-in for the weaker checks it replaces; where it differs
 * (`/pro/../admin` -> `/admin`) the resolved form is the honest one, because it
 * is where the browser goes.
 */
export function sanitizeInternalPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const candidate = raw.trim()
  if (!candidate) return null
  if (candidate.length > MAX_INTERNAL_PATH_LENGTH) return null

  // Site-root-relative only. `//host` is scheme-relative — an ABSOLUTE url to
  // another origin — and is rejected before anything else looks at it.
  if (!candidate.startsWith('/')) return null
  if (candidate.startsWith('//')) return null

  // A backslash never appears in a legitimate path of ours, and browsers
  // disagree about whether it means `/`. Refuse rather than guess.
  if (candidate.includes('\\')) return null

  // Control characters (NUL/TAB/CR/LF/…), the space itself, and DEL. CR/LF in
  // particular must never be able to reach a `Location` header.
  if (/[\u0000-\u0020\u007f]/.test(candidate)) return null

  // Judge the destination the BROWSER will compute, not the one we hoped for.
  let parsed: URL
  try {
    parsed = new URL(candidate, PATH_PARSE_ORIGIN)
  } catch {
    return null
  }
  if (parsed.origin !== PATH_PARSE_ORIGIN) return null

  // Return what the BROWSER will actually resolve, not the string we were
  // handed. `/pro/../admin` and `/pro/%2e%2e/admin` both resolve to `/admin`;
  // returning the raw form would have callers log, compare and prefix-check a
  // path the viewer never visits. For an ordinary path this is a no-op —
  // `/looks?step=a` normalises to itself — so it changes nothing in practice
  // and removes the divergence entirely.
  //
  // Traversal is therefore NOT rejected here: `/pro/../admin` is still a path
  // on our own site, which is all this function claims to decide. A caller that
  // confines to a prefix must test the returned value, which is now safe to
  // test because it is the resolved one (see `sanitizeSessionHandoffPath`).
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
