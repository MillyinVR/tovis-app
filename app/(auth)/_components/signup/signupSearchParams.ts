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
  email: string | null
  phone: string | null
}): string {
  const params = new URLSearchParams()

  appendIfPresent(params, 'ti', args.ti)
  appendIfPresent(params, 'from', args.from)
  appendIfPresent(params, 'next', args.next)
  appendIfPresent(params, 'intent', args.intent)
  appendIfPresent(params, 'inviteToken', args.inviteToken)
  appendIfPresent(params, 'email', args.email)
  appendIfPresent(params, 'phone', args.phone)
  params.set('role', args.role)

  const qs = params.toString()
  return qs ? `/login?${qs}` : '/login'
}

export type SignupForwardedParams = {
  ti: string | null
  from: string | null
  nextFromQuery: string | null
  intent: string | null
  inviteToken: string | null
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
    emailPrefill: normalizeTrimmed(sp.get('email')) ?? '',
    phonePrefill: normalizeTrimmed(sp.get('phone')) ?? '',
    nameParts: splitFullName(normalizeTrimmed(sp.get('name'))),
  }
}
