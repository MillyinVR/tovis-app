// app/(auth)/_components/signup/SignupProClient.tsx
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

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
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

function normalizeHandleInput(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24)
}

// ✅ MATCH YOUR PRISMA ENUM (based on the schema you pasted)
type ProfessionType =
  | 'COSMETOLOGIST'
  | 'BARBER'
  | 'ESTHETICIAN'
  | 'MANICURIST'
  | 'MASSAGE_THERAPIST'
  | 'MAKEUP_ARTIST'

/** CA Board of Barbering & Cosmetology professions (license required) */
function requiresCaBbcLicense(professionType: ProfessionType) {
  return (
    professionType === 'COSMETOLOGIST' ||
    professionType === 'BARBER' ||
    professionType === 'ESTHETICIAN' ||
    professionType === 'MANICURIST'
  )
}

type GooglePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

type ConfirmedLocation = {
  timeZoneId: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  countryCode: string | null
  postalCode: string | null
  placeId: string | null
  formattedAddress: string | null
  name: string | null
}

async function fetchAutocomplete(args: { input: string; sessionToken: string }) {
  const url = new URL('/api/google/places/autocomplete', window.location.origin)
  url.searchParams.set('input', args.input)
  url.searchParams.set('sessionToken', args.sessionToken)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Location search failed.')

  const predictions = Array.isArray(data?.predictions) ? data.predictions : []
  return predictions
    .map((p: any) => ({
      placeId: String(p?.placeId ?? ''),
      description: String(p?.description ?? ''),
      mainText: String(p?.mainText ?? ''),
      secondaryText: String(p?.secondaryText ?? ''),
    }))
    .filter((p: any) => p.placeId && p.description) as GooglePrediction[]
}

async function fetchPlaceDetails(args: { placeId: string; sessionToken: string }) {
  const url = new URL('/api/google/places/details', window.location.origin)
  url.searchParams.set('placeId', args.placeId)
  url.searchParams.set('sessionToken', args.sessionToken)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Could not confirm selected location.')

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
  }
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

export default function SignupProClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const ti = sp.get('ti')
  const loginHref = ti ? `/login?ti=${encodeURIComponent(ti)}` : '/login'

  // identity
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // optional pro fields
  const [businessName, setBusinessName] = useState('')
  const [handle, setHandle] = useState('')

  // profession (required)
  const [professionType, setProfessionType] = useState<ProfessionType>('COSMETOLOGIST')

  // pro mode
  const [proMode, setProMode] = useState<'SALON' | 'MOBILE'>('SALON')
  const [mobileRadiusMiles, setMobileRadiusMiles] = useState('15')

  // CA license (only required for CA BBC professions)
  const [licenseState] = useState<'CA'>('CA')
  const [licenseNumber, setLicenseNumber] = useState('')

  // stable per page load
  const sessionToken = useMemo(
    () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now())),
    [],
  )

  // location
  const [locQuery, setLocQuery] = useState('')
  const [locPredictions, setLocPredictions] = useState<GooglePrediction[]>([])
  const [locLoading, setLocLoading] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedLocation | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const needsLicense = requiresCaBbcLicense(professionType)

  function resetLocation(nextQuery = '') {
    setLocQuery(nextQuery)
    setLocPredictions([])
    setConfirmed(null)
  }

  function locationLabel() {
    return proMode === 'MOBILE' ? 'Base ZIP code' : 'Salon / Suite address'
  }

  function locationPlaceholder() {
    return proMode === 'MOBILE' ? 'Enter your ZIP code (e.g. 92101)' : 'Search your salon / suite address'
  }

  function isLocationConfirmed() {
    if (!confirmed) return false
    if (proMode === 'MOBILE') return Boolean(confirmed.postalCode)
    return Boolean(confirmed.placeId) && Boolean(confirmed.formattedAddress)
  }

  async function refreshPredictions(input: string) {
    setError(null)
    setConfirmed(null)

    // MOBILE: no autocomplete dropdown, just text
    if (proMode === 'MOBILE') {
      setLocQuery(input)
      setLocPredictions([])
      return
    }

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
    } catch (e: any) {
      setLocPredictions([])
      setError(e?.message || 'Location search is unavailable right now.')
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

      setConfirmed({
        timeZoneId: tz,
        lat: details.lat,
        lng: details.lng,
        city: details.city,
        state: details.state,
        countryCode: details.countryCode,
        postalCode: details.postalCode,
        placeId: details.placeId,
        formattedAddress: details.formattedAddress,
        name: details.name,
      })

      setLocPredictions([])
      setLocQuery(p.description)
    } catch (e: any) {
      setConfirmed(null)
      setError(e?.message || 'Could not confirm location.')
    } finally {
      setLocLoading(false)
    }
  }

  async function confirmZip() {
    setError(null)

    const raw = locQuery.trim()
    if (!isUsZip(raw)) {
      setError('Please enter a valid 5-digit ZIP code.')
      return
    }

    setLocLoading(true)
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
        placeId: null,
        formattedAddress: null,
        name: null,
      })

      setLocPredictions([])
      setLocQuery(geo.postalCode ?? raw)
    } catch (e: any) {
      setConfirmed(null)
      setError(e?.message || 'Could not confirm ZIP code.')
    } finally {
      setLocLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required.')
    if (!sanitizePhone(phone).trim()) return setError('Phone number is required.')
    if (!email.trim()) return setError('Email is required.')
    if (!password.trim()) return setError('Password is required.')

    if (!isLocationConfirmed() || !confirmed) {
      return setError(proMode === 'MOBILE' ? 'Please confirm your ZIP code.' : 'Please choose an address from the dropdown.')
    }

    if (proMode === 'MOBILE') {
      const n = Number(mobileRadiusMiles)
      if (!Number.isFinite(n) || n < 1 || n > 200) {
        return setError('Please enter a mobile radius between 1 and 200 miles.')
      }
    }

    if (needsLicense && !licenseNumber.trim()) {
      return setError('License number is required for this profession.')
    }

    const signupLocation =
      proMode === 'MOBILE'
        ? {
            kind: 'PRO_MOBILE' as const,
            postalCode: confirmed.postalCode ?? locQuery.trim(),
            city: confirmed.city,
            state: confirmed.state,
            countryCode: confirmed.countryCode,
            lat: confirmed.lat,
            lng: confirmed.lng,
            timeZoneId: confirmed.timeZoneId,
          }
        : {
            kind: 'PRO_SALON' as const,
            placeId: confirmed.placeId!,
            formattedAddress: confirmed.formattedAddress ?? locQuery.trim(),
            city: confirmed.city,
            state: confirmed.state,
            postalCode: confirmed.postalCode,
            countryCode: confirmed.countryCode,
            lat: confirmed.lat,
            lng: confirmed.lng,
            timeZoneId: confirmed.timeZoneId,
            name: confirmed.name,
          }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role: 'PRO',
          firstName,
          lastName,
          phone: sanitizePhone(phone),
          tapIntentId: ti ?? undefined,

          // optional
          businessName: businessName.trim() ? businessName.trim() : undefined,
          handle: handle.trim() ? normalizeHandleInput(handle.trim()) : undefined,

          // required
          professionType,

          // mobile (miles, number)
          mobileRadiusMiles: proMode === 'MOBILE' ? Number(mobileRadiusMiles) : undefined,

          // CA license: only send when required
          licenseState: needsLicense ? licenseState : undefined,
          licenseNumber: needsLicense ? licenseNumber.trim().toUpperCase() : undefined,

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

      router.replace('/pro/services')
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const handlePreview = normalizeHandleInput(handle.trim())
  const handleIsTrimmed = handle.trim() !== handlePreview

  const canSubmit =
    !loading &&
    firstName.trim() &&
    lastName.trim() &&
    sanitizePhone(phone).trim() &&
    email.trim() &&
    password.trim() &&
    isLocationConfirmed() &&
    (!needsLicense || licenseNumber.trim()) &&
    (proMode !== 'MOBILE' || (Number(mobileRadiusMiles) >= 1 && Number(mobileRadiusMiles) <= 200))

  return (
    <AuthShell title="Create Pro Account" subtitle="Run your business from your phone — set up takes minutes.">
      <form onSubmit={handleSubmit} className="grid gap-5">
        {/* Profession */}
        <div className="grid gap-2">
          <FieldLabel>Profession</FieldLabel>
          <Select
            value={professionType}
            onChange={(e) => {
              const next = e.target.value as ProfessionType
              setProfessionType(next)
              setError(null)
            }}
          >
            <option value="COSMETOLOGIST">Cosmetologist</option>
            <option value="BARBER">Barber</option>
            <option value="ESTHETICIAN">Esthetician</option>
            <option value="MANICURIST">Manicurist</option>
            <option value="MASSAGE_THERAPIST">Massage therapist</option>
            <option value="MAKEUP_ARTIST">Makeup artist</option>
          </Select>

          {professionType === 'MAKEUP_ARTIST' ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
              Makeup artists don’t require a CA license check here. (You’ll add alternative verification later: portfolio + ID, etc.)
            </div>
          ) : null}
        </div>

        {/* Mode */}
        <div className="grid gap-2">
          <FieldLabel>Where do you offer services?</FieldLabel>
          <div className={cx('grid grid-cols-2 gap-2')}>
            <button
              type="button"
              onClick={() => {
                setProMode('SALON')
                setError(null)
                resetLocation('')
              }}
              className={cx(
                'rounded-full border px-3 py-2 text-xs font-black transition',
                proMode === 'SALON'
                  ? 'border-accentPrimary/35 bg-accentPrimary/14 text-textPrimary'
                  : 'border-surfaceGlass/14 bg-bgPrimary/25 text-textSecondary hover:text-textPrimary',
              )}
            >
              In salon / suite
            </button>
            <button
              type="button"
              onClick={() => {
                setProMode('MOBILE')
                setError(null)
                resetLocation('')
              }}
              className={cx(
                'rounded-full border px-3 py-2 text-xs font-black transition',
                proMode === 'MOBILE'
                  ? 'border-accentPrimary/35 bg-accentPrimary/14 text-textPrimary'
                  : 'border-surfaceGlass/14 bg-bgPrimary/25 text-textSecondary hover:text-textPrimary',
              )}
            >
              Mobile
            </button>
          </div>
        </div>

        {/* Location */}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{locationLabel()}</FieldLabel>
            {confirmed?.timeZoneId ? <span className="text-[11px] font-black text-textSecondary/80">{confirmed.timeZoneId}</span> : null}
          </div>

          <div className="relative">
            <Input
              value={locQuery}
              onChange={(e) => refreshPredictions(e.target.value)}
              placeholder={locationPlaceholder()}
              autoComplete="off"
              inputMode={proMode === 'MOBILE' ? 'numeric' : 'text'}
            />

            {/* Suggestions (salon/suite only) */}
            {proMode === 'SALON' && locPredictions.length > 0 ? (
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
            {locLoading ? <HelpText>Confirming…</HelpText> : <span />}

            {isLocationConfirmed() ? (
              <span className="text-xs font-black text-accentPrimary">Confirmed</span>
            ) : proMode === 'MOBILE' ? (
              <button
                type="button"
                onClick={confirmZip}
                disabled={locLoading || !locQuery.trim()}
                className={cx(
                  'inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-black transition',
                  'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
                  'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
                  'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
                  (locLoading || !locQuery.trim()) && 'cursor-not-allowed opacity-60',
                )}
              >
                Confirm ZIP
              </button>
            ) : (
              <HelpText>Pick your address from the dropdown to confirm.</HelpText>
            )}
          </div>
        </div>

        {/* Mobile radius */}
        {proMode === 'MOBILE' ? (
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Mobile radius (miles)</FieldLabel>
              <span className="text-xs font-black text-textSecondary/80">Required</span>
            </div>
            <Input
              value={mobileRadiusMiles}
              onChange={(e) => setMobileRadiusMiles(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 15"
              required
            />
            <HelpText>How far you travel from your base ZIP.</HelpText>
          </label>
        ) : null}

        {/* License block (only when required) */}
        {needsLicense ? (
          <div className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-black text-textPrimary">California license</div>
              <span className="text-xs font-black text-textSecondary/80">Required</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <FieldLabel>State</FieldLabel>
                <Select value={licenseState} disabled>
                  <option value="CA">California</option>
                </Select>
                <HelpText>CA only for now (we’ll expand later).</HelpText>
              </label>

              <label className="grid gap-1.5">
                <FieldLabel>License number</FieldLabel>
                <Input
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="e.g. 123456"
                  autoCapitalize="characters"
                />
              </label>
            </div>
          </div>
        ) : null}

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

        {/* Optional business */}
        <label className="grid gap-1.5">
          <FieldLabel>Business name (optional)</FieldLabel>
          <Input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Salon De Tovis"
            autoComplete="organization"
          />
          <HelpText>You can add this later — we won’t block signup.</HelpText>
        </label>

        {/* Optional handle */}
        <label className="grid gap-1.5">
          <FieldLabel>Handle (optional)</FieldLabel>
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="e.g. iLoveTovis"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <HelpText>
            Optional for now. If you enter one, it will be normalized to{' '}
            <span className="font-black text-textPrimary">{handlePreview || 'your-handle'}</span>
            {handleIsTrimmed ? <span className="text-toneWarn"> (we’ll trim symbols)</span> : null}
          </HelpText>
        </label>

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
            {loading ? 'Creating…' : 'Create Pro Account'}
          </PrimaryButton>

          <SecondaryLinkButton href={loginHref}>Sign in</SecondaryLinkButton>
        </div>
      </form>
    </AuthShell>
  )
}