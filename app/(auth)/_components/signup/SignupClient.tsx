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

/**
 * Premium input:
 * - soft fill (not “empty rectangle”)
 * - restrained border
 * - calm focus ring
 */
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

function RoleSegment({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'relative w-full select-none rounded-full px-3 py-1.5 text-left transition',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
        active
          ? 'bg-accentPrimary/14 text-textPrimary ring-1 ring-accentPrimary/25'
          : 'text-textSecondary hover:text-textPrimary',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <div className="text-sm font-black">{title}</div>
          <div className={cx('text-[11px] leading-snug', active ? 'text-textSecondary/85' : 'text-textSecondary/70')}>
            {subtitle}
          </div>
        </div>

        <span
          className={cx(
            'h-2.5 w-2.5 rounded-full transition',
            active ? 'bg-accentPrimary ring-2 ring-accentPrimary/20' : 'bg-surfaceGlass/20',
          )}
          aria-hidden="true"
        />
      </div>
    </button>
  )
}

function PrimaryButton({
  children,
  loading,
  disabled,
}: {
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className={cx(
        // ✅ group for arrow hover micro-motion
        'group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35',
        // base fill (premium = filled, not outlined)
        'bg-accentPrimary/26 text-textPrimary',
        // glass sheen
        'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
        'hover:bg-accentPrimary/30 hover:border-accentPrimary/45 hover:before:opacity-100',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
        loading ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
      )}
    >
      {/* tiny inner highlight edge */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
      />

      {/* content + micro arrow */}
      <span className="relative inline-flex items-center gap-2">
        <span>{children}</span>
        <span
          aria-hidden="true"
          className={cx('inline-block transition-transform duration-200', 'group-hover:translate-x-0.5')}
        >
          →
        </span>
      </span>
    </button>
  )
}

function SecondaryLinkButton({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cx(
        // slightly smaller than primary, still button-y + noticeable
        'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-[13px] font-black transition',
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

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const roleCopy =
    role === 'CLIENT'
      ? { title: 'Book Services', subtitle: 'Browse and book services, save favorites, and manage appointments.' }
      : { title: 'Offer Services', subtitle: 'Offer services, get booked, and manage your schedule in one place.' }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
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

      if (data?.user?.role === 'PRO') router.replace('/pro/onboarding/verification')
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

          <div className={cx('rounded-card border p-1', 'border-surfaceGlass/12 bg-bgPrimary/25 tovis-glass-soft')}>
            <div className="grid grid-cols-2 gap-1">
              <RoleSegment
                active={role === 'CLIENT'}
                onClick={() => setRole('CLIENT')}
                title="Book Services"
                subtitle="For clients"
              />
              <RoleSegment
                active={role === 'PRO'}
                onClick={() => setRole('PRO')}
                title="Offer Services"
                subtitle="For professionals"
              />
            </div>
          </div>

          <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
            <span className="font-black text-textPrimary">{roleCopy.title}:</span>{' '}
            <span className="leading-relaxed">{roleCopy.subtitle}</span>
          </div>

          {role === 'PRO' ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
              Pro tip: use your <span className="font-black text-textPrimary">legal name</span> as it appears on your
              license.
            </div>
          ) : null}
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
            <span className="text-xs font-black text-textSecondary/80">Optional</span>
          </div>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 (___) ___-____"
          />
          <HelpText>For reminders / verification later.</HelpText>
        </label>

        {/* Email */}
        <label className="grid gap-1.5">
          <FieldLabel>Email address</FieldLabel>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
          />
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
          <HelpText>Use at least 8 characters.</HelpText>
        </label>

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        {/* CTA stack */}
        <div className="grid gap-2 pt-1">
          <PrimaryButton loading={loading} disabled={loading}>
            {loading ? 'Creating…' : 'Sign up'}
          </PrimaryButton>

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
