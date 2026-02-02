// app/(auth)/_components/signup/SignupClient.tsx
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthShell from '../AuthShell'

function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function sanitizeRole(v: string | null): 'CLIENT' | 'PRO' {
  const s = (v ?? '').toUpperCase()
  return s === 'PRO' ? 'PRO' : 'CLIENT'
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

function PasswordToggle({ pressed, onClick }: { pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black transition',
        'border-surfaceGlass/12 bg-bgPrimary/30 text-textSecondary',
        'hover:border-surfaceGlass/18 hover:text-textPrimary',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
      )}
    >
      {pressed ? 'Hide' : 'Show'}
    </button>
  )
}

function PillToggle({
  left,
  right,
  value,
  onChange,
}: {
  left: { label: string; value: string }
  right: { label: string; value: string }
  value: string
  onChange: (v: string) => void
}) {
  const base =
    'inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-black transition focus:outline-none focus:ring-2 focus:ring-accentPrimary/20'
  const active = 'bg-accentPrimary/14 text-textPrimary ring-1 ring-accentPrimary/25'
  const idle = 'text-textSecondary hover:text-textPrimary'

  return (
    <div className={cx('rounded-full border p-1', 'border-surfaceGlass/12 bg-bgPrimary/25 tovis-glass-soft')}>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" className={cx(base, value === left.value ? active : idle)} onClick={() => onChange(left.value)}>
          {left.label}
        </button>
        <button type="button" className={cx(base, value === right.value ? active : idle)} onClick={() => onChange(right.value)}>
          {right.label}
        </button>
      </div>
    </div>
  )
}

type GooglePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

type GooglePlaceDetails = {
  placeId: string
  name: string | null
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
}

async function fetchAutocomplete(args: { input: string; sessionToken: string }) {
  const url = new URL('/api/google/places/autocomplete', window.location.origin)
  url.searchParams.set('input', args.input)
  url.searchParams.set('sessionToken', args.sessionToken)
  url.searchParams.set('components', 'country:us')
  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Autocomplete failed.')
  const predictions = Array.isArray(data?.predictions) ? data.predictions : []
  return predictions.map((p: any) => ({
    placeId: String(p?.placeId ?? ''),
    description: String(p?.description ?? ''),
    mainText: String(p?.mainText ?? ''),
    secondaryText: String(p?.secondaryText ?? ''),
  })) as GooglePrediction[]
}

async function fetchPlaceDetails(args: { placeId: string; sessionToken: string }) {
  const url = new URL('/api/google/places/details', window.location.origin)
  url.searchParams.set('placeId', args.placeId)
  url.searchParams.set('sessionToken', args.sessionToken)
  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Place details failed.')
  const p = data?.place ?? {}
  return {
    placeId: String(p?.placeId ?? args.placeId),
    name: typeof p?.name === 'string' ? p.name : null,
    formattedAddress: typeof p?.formattedAddress === 'string' ? p.formattedAddress : null,
    lat: typeof p?.lat === 'number' ? p.lat : null,
    lng: typeof p?.lng === 'number' ? p.lng : null,
    city: typeof p?.city === 'string' ? p.city : null,
    state: typeof p?.state === 'string' ? p.state : null,
    postalCode: typeof p?.postalCode === 'string' ? p.postalCode : null,
    countryCode: typeof p?.countryCode === 'string' ? p.countryCode : null,
  } as GooglePlaceDetails
}

async function fetchTimeZoneId(args: { lat: number; lng: number }) {
  const url = new URL('/api/google/timezone', window.location.origin)
  url.searchParams.set('lat', String(args.lat))
  url.searchParams.set('lng', String(args.lng))
  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Timezone lookup failed.')
  return String(data?.timeZoneId ?? '')
}

function PrimaryButton({ children, loading }: { children: React.ReactNode; loading: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={cx(
        'relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35',
        'bg-accentPrimary/26 text-textPrimary',
        'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
        'hover:bg-accentPrimary/30 hover:border-accentPrimary/45 hover:before:opacity-100',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
        loading ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
      />
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

export default function SignupClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const ti = sp.get('ti')
  const roleParam = sp.get('role')
  const roleFromQuery = useMemo(() => (roleParam ? sanitizeRole(roleParam) : null), [roleParam])
  const [role, setRole] = useState<'CLIENT' | 'PRO'>(roleFromQuery ?? 'CLIENT')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // ✅ Pro work mode
  const [proMode, setProMode] = useState<'SALON' | 'MOBILE'>('SALON')

  // Google session token (stable per signup page load)
  const sessionToken = useMemo(() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now())), [])

  // Location selection state
  const [locQuery, setLocQuery] = useState('')
  const [locPredictions, setLocPredictions] = useState<GooglePrediction[]>([])
  const [locLoading, setLocLoading] = useState(false)
  const [locPicked, setLocPicked] = useState<GooglePlaceDetails | null>(null)
  const [timeZoneId, setTimeZoneId] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const roleCopy =
    role === 'CLIENT'
      ? { title: 'Book Services', subtitle: 'Browse and book services, save favorites, and manage appointments.' }
      : { title: 'Offer Services', subtitle: 'Offer services, get booked, and manage your schedule in one place.' }

  async function refreshPredictions(input: string) {
    setLocPicked(null)
    setTimeZoneId(null)
    setLocQuery(input)

    const trimmed = input.trim()
    if (trimmed.length < 2) {
      setLocPredictions([])
      return
    }

    setLocLoading(true)
    try {
      const preds = await fetchAutocomplete({ input: trimmed, sessionToken })
      setLocPredictions(preds.slice(0, 6))
    } catch {
      setLocPredictions([])
    } finally {
      setLocLoading(false)
    }
  }

  async function pickPrediction(p: GooglePrediction) {
    setError(null)
    setLocLoading(true)
    try {
      const details = await fetchPlaceDetails({ placeId: p.placeId, sessionToken })
      if (details.lat == null || details.lng == null) throw new Error('Selected place is missing coordinates.')
      const tz = await fetchTimeZoneId({ lat: details.lat, lng: details.lng })
      if (!tz) throw new Error('No timezone returned.')
      setLocPicked(details)
      setTimeZoneId(tz)
      setLocPredictions([])
      setLocQuery(p.description)
    } catch (e: any) {
      setLocPicked(null)
      setTimeZoneId(null)
      setError(e?.message || 'Could not confirm location.')
    } finally {
      setLocLoading(false)
    }
  }

  function locationLabel() {
    if (role === 'CLIENT') return 'ZIP code'
    if (proMode === 'MOBILE') return 'Base ZIP code'
    return 'Salon address'
  }

  function locationPlaceholder() {
    if (role === 'CLIENT') return 'Enter your ZIP code'
    if (proMode === 'MOBILE') return 'Enter your base ZIP code'
    return 'Search your salon address'
  }

  function isLocationConfirmed() {
    // We confirm location by selecting a place that has tz + (zip OR address)
    if (!locPicked || !timeZoneId) return false

    if (role === 'CLIENT') return Boolean(locPicked.postalCode)
    if (proMode === 'MOBILE') return Boolean(locPicked.postalCode)
    return Boolean(locPicked.formattedAddress) && Boolean(locPicked.placeId)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)

    // ✅ enforce location confirm at signup
    if (!isLocationConfirmed() || !timeZoneId || !locPicked) {
      setError('Please confirm your location first.')
      return
    }

    // ✅ enforce pro phone
    if (role === 'PRO' && !sanitizePhone(phone)) {
      setError('Phone number is required for professionals.')
      return
    }

    const signupLocation =
      role === 'PRO'
        ? proMode === 'SALON'
          ? {
              kind: 'PRO_SALON',
              placeId: locPicked.placeId,
              formattedAddress: locPicked.formattedAddress ?? locQuery,
              city: locPicked.city,
              state: locPicked.state,
              postalCode: locPicked.postalCode,
              countryCode: locPicked.countryCode,
              lat: locPicked.lat,
              lng: locPicked.lng,
              timeZoneId,
              name: locPicked.name,
            }
          : {
              kind: 'PRO_MOBILE',
              postalCode: locPicked.postalCode ?? locQuery,
              city: locPicked.city,
              state: locPicked.state,
              countryCode: locPicked.countryCode,
              lat: locPicked.lat,
              lng: locPicked.lng,
              timeZoneId,
            }
        : {
            kind: 'CLIENT_ZIP',
            postalCode: locPicked.postalCode ?? locQuery,
            city: locPicked.city,
            state: locPicked.state,
            countryCode: locPicked.countryCode,
            lat: locPicked.lat,
            lng: locPicked.lng,
            timeZoneId,
          }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role,
          firstName,
          lastName,
          phone: phone ? sanitizePhone(phone) : undefined,
          tapIntentId: ti ?? undefined,

          // ✅ timezone driven from confirmed place
          timeZone: timeZoneId,

          // ✅ pro/client location payload
          signupLocation,
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

      if (data?.user?.role === 'PRO') router.replace('/pro/services')
      else router.replace('/client')
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const loginHref = ti ? `/login?ti=${encodeURIComponent(ti)}` : '/login'

  return (
    <AuthShell title="Create Account" subtitle="Join our community of beauty professionals and clients.">
      <form onSubmit={handleSubmit} className="grid gap-5">
        {/* Role selection */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-black tracking-wide text-textSecondary">I want to</div>
            <div className="text-[11px] text-textSecondary/70">You can change this later.</div>
          </div>

          <PillToggle
            left={{ label: 'Book Services', value: 'CLIENT' }}
            right={{ label: 'Offer Services', value: 'PRO' }}
            value={role}
            onChange={(v) => {
              const next = v === 'PRO' ? 'PRO' : 'CLIENT'
              setRole(next)
              setError(null)
              // reset location state when switching roles
              setLocQuery('')
              setLocPredictions([])
              setLocPicked(null)
              setTimeZoneId(null)
            }}
          />

          <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
            <span className="font-black text-textPrimary">{roleCopy.title}:</span>{' '}
            <span className="leading-relaxed">{roleCopy.subtitle}</span>
          </div>

          {role === 'PRO' ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
              Pro tip: use your <span className="font-black text-textPrimary">legal name</span> as it appears on your license.
            </div>
          ) : null}
        </div>

        {/* Pro mode toggle */}
        {role === 'PRO' ? (
          <div className="grid gap-2">
            <FieldLabel>Where do you offer services?</FieldLabel>
            <PillToggle
              left={{ label: 'In Salon', value: 'SALON' }}
              right={{ label: 'Mobile', value: 'MOBILE' }}
              value={proMode}
              onChange={(v) => {
                const next = v === 'MOBILE' ? 'MOBILE' : 'SALON'
                setProMode(next)
                setError(null)
                // reset location state when switching mode
                setLocQuery('')
                setLocPredictions([])
                setLocPicked(null)
                setTimeZoneId(null)
              }}
            />
          </div>
        ) : null}

        {/* Location confirm */}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{locationLabel()}</FieldLabel>
            {timeZoneId ? <span className="text-[11px] font-black text-textSecondary/80">{timeZoneId}</span> : null}
          </div>

          <div className="relative">
            <Input
              value={locQuery}
              onChange={(e) => refreshPredictions(e.target.value)}
              placeholder={locationPlaceholder()}
              autoComplete="off"
              inputMode={role !== 'PRO' || proMode === 'MOBILE' ? 'numeric' : 'text'}
            />

            {/* Suggestions */}
            {locPredictions.length > 0 ? (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-card border border-surfaceGlass/12 bg-bgPrimary/60 tovis-glass-soft">
                <div className="max-h-64 overflow-auto p-1">
                  {locPredictions.map((p) => (
                    <button
                      key={p.placeId}
                      type="button"
                      onClick={() => pickPrediction(p)}
                      className={cx(
                        'w-full rounded-card px-3 py-2 text-left transition',
                        'hover:bg-bgPrimary/35 focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
                      )}
                    >
                      <div className="text-sm font-black text-textPrimary">{p.mainText || p.description}</div>
                      <div className="text-xs text-textSecondary/80">{p.secondaryText}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            {locLoading ? <HelpText>Confirming…</HelpText> : null}

            {isLocationConfirmed() ? (
              <span className="text-xs font-black text-accentPrimary">Confirmed</span>
            ) : (
              <HelpText>
                {role === 'PRO'
                  ? proMode === 'MOBILE'
                    ? 'Pick your ZIP from the dropdown to confirm.'
                    : 'Pick your address from the dropdown to confirm.'
                  : 'Pick your ZIP from the dropdown to confirm.'}
              </HelpText>
            )}
          </div>
        </div>

        <div className="h-px w-full bg-surfaceGlass/10" />

        {/* Identity */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <FieldLabel>First name</FieldLabel>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Last name</FieldLabel>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
          </label>
        </div>

        {/* Phone */}
        <label className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Phone</FieldLabel>
            {role === 'CLIENT' ? <span className="text-xs font-black text-textSecondary/80">Optional</span> : null}
          </div>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 (___) ___-____"
            required={role === 'PRO'}
          />
          <HelpText>{role === 'PRO' ? 'Required for professionals.' : 'For reminders / verification later.'}</HelpText>
        </label>

        {/* Email */}
        <label className="grid gap-1.5">
          <FieldLabel>Email address</FieldLabel>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" inputMode="email" />
        </label>

        {/* Password */}
        <label className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Password</FieldLabel>
            <PasswordToggle pressed={showPassword} onClick={() => setShowPassword((v) => !v)} />
          </div>

          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            placeholder="Create a strong one"
          />
          <HelpText>Use a strong password you won’t forget.</HelpText>
        </label>

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        {/* CTA stack */}
        <div className="grid gap-2 pt-1">
          <PrimaryButton loading={loading}>{loading ? 'Creating…' : 'Sign up'}</PrimaryButton>
          <SecondaryLinkButton href={loginHref}>Sign in</SecondaryLinkButton>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-textSecondary">
            <div className="text-textSecondary/70">No spam. Just bookings.</div>

            <div className="text-textSecondary/80">
              By continuing, you agree to{' '}
              <Link href="/terms" className="font-black text-textPrimary hover:text-accentPrimary">
                Terms
              </Link>{' '}
              &{' '}
              <Link href="/privacy" className="font-black text-textPrimary hover:text-accentPrimary">
                Privacy
              </Link>
              .
            </div>
          </div>
        </div>
      </form>
    </AuthShell>
  )
}
