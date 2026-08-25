// app/(auth)/_components/signup/signupSearchParams.ts
//
// Shared handling for the query params the signup chooser forwards to both
// signup forms (ti, from, next, intent, inviteToken, email, phone, name).

export function normalizeTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function sanitizeNextUrl(nextUrl: unknown): string | null {
  if (typeof nextUrl !== 'string') return null
  const s = nextUrl.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

export function splitFullName(fullName: string | null): {
  firstName: string
  lastName: string
} {
  if (!fullName) {
    return { firstName: '', lastName: '' }
  }

  const parts = fullName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return { firstName: '', lastName: '' }
  }

  if (parts.length === 1) {
    return { firstName: parts[0] ?? '', lastName: '' }
  }

  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

function appendIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value) params.set(key, value)
}

export function buildLoginHref(args: {
  role: 'CLIENT' | 'PRO'
  ti: string | null
  from: string | null
  next: string | null
  intent: string | null
  inviteToken: string | null
  /** Claim-link channel marker pair (via/vsig) — forwarded verbatim. */
  via?: string | null
  vsig?: string | null
  email: string | null
  phone: string | null
}): string {
  const params = new URLSearchParams()

  appendIfPresent(params, 'ti', args.ti)
  appendIfPresent(params, 'from', args.from)
  appendIfPresent(params, 'next', args.next)
  appendIfPresent(params, 'intent', args.intent)
  appendIfPresent(params, 'inviteToken', args.inviteToken)
  appendIfPresent(params, 'via', args.via ?? null)
  appendIfPresent(params, 'vsig', args.vsig ?? null)
  appendIfPresent(params, 'email', args.email)
  appendIfPresent(params, 'phone', args.phone)
  params.set('role', args.role)

  const qs = params.toString()
  return qs ? `/login?${qs}` : '/login'
}

/** Where a social sign-in that turned out to be a SIGNUP has to finish. */
const SOCIAL_COMPLETE_PATH = '/signup/social'

/**
 * The completion form's href, carrying the params a signup must not lose —
 * above all `intent` / `inviteToken` / `via` / `vsig`, without which a claim
 * link's whole point (adopting the history a pro already recorded) is dropped
 * silently. The TICKET is not in here: it is a credential and travels through
 * sessionStorage, never a URL. See socialSignupHandoff.ts.
 */
export function buildSocialCompleteHref(
  sp: Pick<URLSearchParams, 'get'>,
): string {
  const params = new URLSearchParams()

  appendIfPresent(params, 'ti', normalizeTrimmed(sp.get('ti')))
  appendIfPresent(params, 'from', sanitizeNextUrl(sp.get('from')))
  appendIfPresent(params, 'next', sanitizeNextUrl(sp.get('next')))
  appendIfPresent(params, 'intent', normalizeTrimmed(sp.get('intent')))
  appendIfPresent(params, 'inviteToken', normalizeTrimmed(sp.get('inviteToken')))
  appendIfPresent(params, 'via', normalizeTrimmed(sp.get('via')))
  appendIfPresent(params, 'vsig', normalizeTrimmed(sp.get('vsig')))

  const qs = params.toString()
  return qs ? `${SOCIAL_COMPLETE_PATH}?${qs}` : SOCIAL_COMPLETE_PATH
}

export type SignupForwardedParams = {
  ti: string | null
  from: string | null
  nextFromQuery: string | null
  intent: string | null
  inviteToken: string | null
  /**
   * Claim-link channel marker (which channel delivered the claim link, plus
   * its signature). Opaque here — carried through to the register call, where
   * the server validates the signature before crediting anything.
   */
  via: string | null
  vsig: string | null
  emailPrefill: string
  phonePrefill: string
  nameParts: { firstName: string; lastName: string }
}

export function readSignupForwardedParams(
  sp: Pick<URLSearchParams, 'get'>,
): SignupForwardedParams {
  const from = sanitizeNextUrl(sp.get('from'))

  return {
    ti: normalizeTrimmed(sp.get('ti')),
    from,
    nextFromQuery: sanitizeNextUrl(sp.get('next')) ?? from,
    intent: normalizeTrimmed(sp.get('intent')),
    inviteToken: normalizeTrimmed(sp.get('inviteToken')),
    via: normalizeTrimmed(sp.get('via')),
    vsig: normalizeTrimmed(sp.get('vsig')),
    emailPrefill: normalizeTrimmed(sp.get('email')) ?? '',
    phonePrefill: normalizeTrimmed(sp.get('phone')) ?? '',
    nameParts: splitFullName(normalizeTrimmed(sp.get('name'))),
  }
}
