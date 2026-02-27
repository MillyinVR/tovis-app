// app/(auth)/_components/signup/SignupClientClient.tsx
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthShell from '../AuthShell'

function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function sanitizePhone(v: string) {
  return v.replace(/\s+/g, '')
}

function sanitizeNextUrl(nextUrl: unknown): string | null {
  if (typeof nextUrl !== 'string') return null
  const s = nextUrl.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-black tracking-wide text-textSecondary">{children}</span>
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-textSecondary/80">{children}</span>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
        'placeholder:text-textSecondary/70',
        'hover:border-surfaceGlass/16',
        'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15',
        props.disabled && 'opacity-70',
        props.className ?? '',
      )}
    />
  )
}

function PrimaryButton({
  children,
  loading,
  disabled,
}: {
  children: React.ReactNode
  loading: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35',
        'bg-accentPrimary/26 text-textPrimary',
        'hover:bg-accentPrimary/30 hover:border-accentPrimary/45',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
        loading ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
      )}
    >
      <span className="relative">{children}</span>
    </button>
  )
}

function SecondaryLinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-sm font-black transition',
        'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
        'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
      )}
    >
      {children}
    </Link>
  )
}

function isUsZip(raw: string) {
  const s = raw.trim()
  return /^\d{5}(-\d{4})?$/.test(s)
}

type ConfirmedZip = {
  timeZoneId: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  countryCode: string | null
  postalCode: string
}

async function fetchGeocodeByPostal(args: { postalCode: string }) {
  const url = new URL('/api/google/geocode', window.location.origin)
  url.searchParams.set('postalCode', args.postalCode)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'ZIP lookup failed.')

  const g = data?.geo ?? {}
  const lat = typeof g?.lat === 'number' ? g.lat : null
  const lng = typeof g?.lng === 'number' ? g.lng : null
  const postalCode = typeof g?.postalCode === 'string' ? g.postalCode : null
  const city = typeof g?.city === 'string' ? g.city : null
  const state = typeof g?.state === 'string' ? g.state : null
  const countryCode = typeof g?.countryCode === 'string' ? g.countryCode : null

  if (lat == null || lng == null) throw new Error('ZIP lookup returned no coordinates.')
  if (!postalCode) throw new Error('ZIP lookup did not resolve a valid postal code.')

  return { lat, lng, postalCode, city, state, countryCode }
}

async function fetchTimeZoneId(args: { lat: number; lng: number }) {
  const url = new URL('/api/google/timezone', window.location.origin)
  url.searchParams.set('lat', String(args.lat))
  url.searchParams.set('lng', String(args.lng))

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Timezone lookup failed.')

  const tz = String(data?.timeZoneId ?? '')
  if (!tz) throw new Error('No timezone returned.')
  return tz
}

export default function SignupClientClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const ti = sp.get('ti')
  const loginHref = ti ? `/login?ti=${encodeURIComponent(ti)}` : '/login'

  // stable per page load (nice if you later add autocomplete)
  useMemo(() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now())), [])

  // identity
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  // location
  const [zip, setZip] = useState('')
  const [zipLoading, setZipLoading] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedZip | null>(null)

  // contact + auth
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function resetZip(next = '') {
    setZip(next)
    setConfirmed(null)
  }

  // Auto-confirm on blur + safe to call from submit
  async function confirmZipIfValid(rawInput?: string) {
    const raw = (rawInput ?? zip).trim()

    // empty: let required validation handle it
    if (!raw) return false

    // already confirmed for this ZIP: no-op
    if (confirmed?.postalCode && confirmed.postalCode === raw) return true

    if (!isUsZip(raw)) {
      setConfirmed(null)
      setError('Please enter a valid 5-digit ZIP code.')
      return false
    }

    if (zipLoading) return Boolean(confirmed)

    setZipLoading(true)
    setError(null)

    try {
      const geo = await fetchGeocodeByPostal({ postalCode: raw })
      const tz = await fetchTimeZoneId({ lat: geo.lat, lng: geo.lng })

      setConfirmed({
        timeZoneId: tz,
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        state: geo.state,
        countryCode: geo.countryCode,
        postalCode: geo.postalCode,
      })

      setZip(geo.postalCode ?? raw)
      return true
    } catch (e: any) {
      setConfirmed(null)
      setError(e?.message || 'Could not confirm ZIP code.')
      return false
    } finally {
      setZipLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required.')

    // force-confirm ZIP if user never blurred the field
    const zipOk = await confirmZipIfValid(zip)
    if (!zipOk || !confirmed) return setError('Please enter a valid ZIP code.')

    if (!sanitizePhone(phone).trim()) return setError('Phone number is required.')
    if (!email.trim()) return setError('Email is required.')
    if (!password.trim()) return setError('Password is required.')

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role: 'CLIENT',
          firstName,
          lastName,
          phone: sanitizePhone(phone),
          tapIntentId: ti ?? undefined,

          signupLocation: {
            kind: 'CLIENT_ZIP',
            postalCode: confirmed.postalCode,
            city: confirmed.city,
            state: confirmed.state,
            countryCode: confirmed.countryCode,
            lat: confirmed.lat,
            lng: confirmed.lng,
            timeZoneId: confirmed.timeZoneId,
          },
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) {
        setError(data?.error || 'Signup failed.')
        return
      }

      router.refresh()

      const nextUrl = sanitizeNextUrl(data?.nextUrl)
      if (nextUrl) return router.replace(nextUrl)

      router.replace('/feed')
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit =
    !loading &&
    firstName.trim() &&
    lastName.trim() &&
    isUsZip(zip) &&
    sanitizePhone(phone).trim() &&
    email.trim() &&
    password.trim() &&
    Boolean(confirmed)

  return (
    <AuthShell title="Create Client Account" subtitle="Find pros, book fast, and keep your beauty life organized.">
      <form onSubmit={handleSubmit} className="grid gap-5">
        {/* Identity (ZIP under last name) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <FieldLabel>First name</FieldLabel>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Last name</FieldLabel>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
          </label>

          <label className="grid gap-1.5 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>ZIP code</FieldLabel>
              {confirmed?.timeZoneId ? (
                <span className="text-[11px] font-black text-textSecondary/80">{confirmed.timeZoneId}</span>
              ) : null}
            </div>

            <Input
              value={zip}
              onChange={(e) => {
                const v = e.target.value
                setZip(v)
                setConfirmed(null) // invalidate when user edits
                setError(null)
              }}
              onBlur={() => {
                // don’t block UI; confirmZipIfValid manages its own loading state
                void confirmZipIfValid(zip)
              }}
              placeholder="e.g. 92024"
              inputMode="numeric"
              autoComplete="postal-code"
            />

            <div className="flex items-center justify-between gap-3">
              {zipLoading ? <HelpText>Confirming…</HelpText> : <HelpText>We’ll confirm this when you leave the field.</HelpText>}

              {confirmed ? <span className="text-xs font-black text-accentPrimary">Confirmed</span> : null}
            </div>

            {confirmed && (confirmed.city || confirmed.state) ? (
              <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
                <span className="font-black text-textPrimary">Near:</span>{' '}
                <span>{[confirmed.city, confirmed.state].filter(Boolean).join(', ')}</span>
                <button
                  type="button"
                  className="ml-3 text-xs font-black text-textPrimary/80 hover:text-textPrimary"
                  onClick={() => resetZip(zip)}
                >
                  Change
                </button>
              </div>
            ) : null}
          </label>
        </div>

        <div className="h-px w-full bg-surfaceGlass/10" />

        {/* Phone */}
        <label className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Phone</FieldLabel>
            <span className="text-xs font-black text-textSecondary/80">Required</span>
          </div>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 (___) ___-____"
            required
          />
        </label>

        {/* Email */}
        <label className="grid gap-1.5">
          <FieldLabel>Email address</FieldLabel>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" inputMode="email" />
        </label>

        {/* Password */}
        <label className="grid gap-1.5">
          <FieldLabel>Password</FieldLabel>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required autoComplete="new-password" />
        </label>

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-2 pt-1">
          <PrimaryButton loading={loading} disabled={!canSubmit}>
            {loading ? 'Creating…' : 'Create Client Account'}
          </PrimaryButton>

          <SecondaryLinkButton href={loginHref}>Sign in</SecondaryLinkButton>
        </div>
      </form>
    </AuthShell>
  )
}