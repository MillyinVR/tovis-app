// app/client/settings/ClientProfileSettings.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { safeJson, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type ClientSettingsProfile = {
  id: string
  email: string | null
  firstName: string
  lastName: string
  phone: string | null
  avatarUrl: string | null
  dateOfBirth: string | null
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-black tracking-[var(--ls-caps)] text-textSecondary">
      {children}
    </span>
  )
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-textSecondary/80">{children}</span>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-white/10 bg-bgSecondary/35 text-textPrimary',
        'placeholder:text-textSecondary/70',
        'hover:border-white/15',
        'focus:border-[rgb(var(--accent-primary)/0.35)] focus:ring-2 focus:ring-[rgb(var(--accent-primary)/0.15)]',
        props.disabled && 'opacity-70',
        props.className ?? '',
      )}
    />
  )
}

function pickProfile(raw: unknown): ClientSettingsProfile | null {
  if (!isRecord(raw)) return null
  const profile = raw.profile
  if (!isRecord(profile)) return null

  const id = typeof profile.id === 'string' ? profile.id.trim() : ''
  const firstName =
    typeof profile.firstName === 'string' ? profile.firstName : ''
  const lastName =
    typeof profile.lastName === 'string' ? profile.lastName : ''

  if (!id) return null

  return {
    id,
    email:
      typeof profile.email === 'string' && profile.email.trim()
        ? profile.email.trim()
        : null,
    firstName,
    lastName,
    phone:
      typeof profile.phone === 'string' && profile.phone.trim()
        ? profile.phone.trim()
        : null,
    avatarUrl:
      typeof profile.avatarUrl === 'string' && profile.avatarUrl.trim()
        ? profile.avatarUrl.trim()
        : null,
    dateOfBirth:
      typeof profile.dateOfBirth === 'string' && profile.dateOfBirth.trim()
        ? profile.dateOfBirth.trim()
        : null,
  }
}

function normalizePhoneInput(value: string) {
  return value.replace(/\s+/g, ' ').trimStart()
}

export default function ClientProfileSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [profile, setProfile] = useState<ClientSettingsProfile | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const res = await fetch('/api/client/settings', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)

      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? 'Failed to load profile.')
      }

      const next = pickProfile(raw)
      if (!next) {
        throw new Error('Settings response was malformed.')
      }

      setProfile(next)
      setFirstName(next.firstName)
      setLastName(next.lastName)
      setPhone(next.phone ?? '')
      setAvatarUrl(next.avatarUrl ?? '')
      setDateOfBirth(next.dateOfBirth ?? '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load profile.')
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const dirty = useMemo(() => {
    if (!profile) return false

    return (
      firstName !== profile.firstName ||
      lastName !== profile.lastName ||
      phone !== (profile.phone ?? '') ||
      avatarUrl !== (profile.avatarUrl ?? '') ||
      dateOfBirth !== (profile.dateOfBirth ?? '')
    )
  }, [profile, firstName, lastName, phone, avatarUrl, dateOfBirth])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile || saving || !dirty) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const payload = {
        firstName,
        lastName,
        phone: phone.trim() ? normalizePhoneInput(phone) : null,
        avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
        dateOfBirth: dateOfBirth.trim() ? dateOfBirth.trim() : null,
      }

      const res = await fetch('/api/client/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const raw = await safeJson(res)

      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? 'Failed to save profile.')
      }

      const next = pickProfile(raw)
      if (!next) {
        throw new Error('Updated settings response was malformed.')
      }

      setProfile(next)
      setFirstName(next.firstName)
      setLastName(next.lastName)
      setPhone(next.phone ?? '')
      setAvatarUrl(next.avatarUrl ?? '')
      setDateOfBirth(next.dateOfBirth ?? '')
      setSuccess('Profile updated.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    if (!profile || saving) return
    setError(null)
    setSuccess(null)
    setFirstName(profile.firstName)
    setLastName(profile.lastName)
    setPhone(profile.phone ?? '')
    setAvatarUrl(profile.avatarUrl ?? '')
    setDateOfBirth(profile.dateOfBirth ?? '')
  }

  return (
    <section className="brand-glass p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
            Profile
          </div>
          <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
            Keep your account details current. Saved addresses are separate so your
            search area and mobile service locations can change without touching your
            identity details.
          </div>
        </div>

        {profile?.email ? (
          <div className="rounded-full border border-white/10 bg-bgSecondary/35 px-3 py-1 text-[11px] font-black text-textSecondary">
            {profile.email}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-3 text-sm font-semibold text-textSecondary">
          Loading profile…
        </div>
      ) : null}

      {!loading && error ? (
        <div className="mt-4 rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
          {error}
        </div>
      ) : null}

      {!loading && success ? (
        <div className="mt-4 rounded-card border border-[rgb(var(--accent-primary)/0.20)] bg-[rgb(var(--accent-primary)/0.10)] px-3 py-2 text-sm font-bold text-textPrimary">
          {success}
        </div>
      ) : null}

      {!loading && profile ? (
        <form onSubmit={onSubmit} className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <FieldLabel>First name</FieldLabel>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                placeholder="First name"
                disabled={saving}
              />
            </label>

            <label className="grid gap-1.5">
              <FieldLabel>Last name</FieldLabel>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                placeholder="Last name"
                disabled={saving}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <FieldLabel>Phone</FieldLabel>
              <Input
                value={phone}
                onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
                autoComplete="tel"
                inputMode="tel"
                placeholder="+1 (___) ___-____"
                disabled={saving}
              />
              <HelpText>
                Used for appointment updates and booking communication.
              </HelpText>
            </label>

            <label className="grid gap-1.5">
              <FieldLabel>Birthday</FieldLabel>
              <Input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={saving}
                max="9999-12-31"
              />
              <HelpText>
                Optional for now. Later this can support better personalization.
              </HelpText>
            </label>
          </div>

          <label className="grid gap-1.5">
            <FieldLabel>Avatar URL</FieldLabel>
            <Input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              autoComplete="url"
              placeholder="https://…"
              disabled={saving}
            />
            <HelpText>
              Optional. Leave blank if you do not want to set this yet.
            </HelpText>
          </label>

          <div className="rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
            <span className="font-black text-textPrimary">Heads up:</span>{' '}
            address management lives in the saved addresses section so discovery
            location and mobile destination don’t get tangled together.
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetForm}
              disabled={saving || !dirty}
              className={cn(
                'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-black transition',
                'border-white/10 bg-bgPrimary/25 text-textPrimary',
                'hover:border-white/15 hover:bg-bgPrimary/30',
                'focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-primary)/0.15)]',
                (saving || !dirty) && 'cursor-not-allowed opacity-60',
              )}
            >
              Reset
            </button>

            <button
              type="submit"
              disabled={saving || !dirty}
              className={cn(
                'relative inline-flex items-center justify-center overflow-hidden rounded-full px-4 py-2 text-sm font-black transition',
                'border border-[rgb(var(--accent-primary)/0.35)] bg-[rgb(var(--accent-primary)/0.18)] text-textPrimary',
                'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
                'hover:bg-[rgb(var(--accent-primary)/0.24)] hover:border-[rgb(var(--accent-primary)/0.45)] hover:before:opacity-100',
                'focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent-primary)/0.20)]',
                (saving || !dirty) ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
              )}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
              />
              <span className="relative">{saving ? 'Saving…' : 'Save profile'}</span>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}