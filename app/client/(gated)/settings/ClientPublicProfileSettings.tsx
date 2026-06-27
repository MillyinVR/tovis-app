// app/client/(gated)/settings/ClientPublicProfileSettings.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import ToggleSwitch from '@/app/_components/ToggleSwitch'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'
import { sanitizeHandleInput } from '@/lib/handles'

type PublicProfile = {
  handle: string
  isPublicProfile: boolean
  publicBio: string
}

const BIO_MAX = 280

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-black tracking-[var(--ls-caps)] text-textSecondary">
      {children}
    </span>
  )
}

function pickProfile(raw: unknown): PublicProfile | null {
  if (!isRecord(raw)) return null
  const profile = isRecord(raw.profile) ? raw.profile : null
  if (!profile) return null
  return {
    handle: typeof profile.handle === 'string' ? profile.handle : '',
    isPublicProfile: profile.isPublicProfile === true,
    publicBio: typeof profile.publicBio === 'string' ? profile.publicBio : '',
  }
}

export default function ClientPublicProfileSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [saved, setSaved] = useState<PublicProfile | null>(null)
  const [handle, setHandle] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [bio, setBio] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/client/profile', {
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(raw) ?? 'Failed to load.')
      const profile = pickProfile(raw)
      if (profile) {
        setSaved(profile)
        setHandle(profile.handle)
        setIsPublic(profile.isPublicProfile)
        setBio(profile.publicBio)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => {
    if (!saved) return false
    return (
      handle !== saved.handle ||
      isPublic !== saved.isPublicProfile ||
      bio !== saved.publicBio
    )
  }, [saved, handle, isPublic, bio])

  const canGoPublic = handle.trim().length > 0

  async function onSave() {
    if (saving || !dirty) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/v1/client/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ handle, isPublicProfile: isPublic, publicBio: bio }),
      })
      const raw = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(raw) ?? 'Failed to save.')
      const profile = pickProfile(raw)
      if (profile) {
        setSaved(profile)
        setHandle(profile.handle)
        setIsPublic(profile.isPublicProfile)
        setBio(profile.publicBio)
      }
      setSuccess('Public profile updated.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="brand-glass p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
            Public profile
          </div>
          <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
            Claim a handle and make your looks shareable on your own public profile
            at /u/your-handle.
          </div>
        </div>
        {saved?.isPublicProfile && saved.handle ? (
          <Link
            href={`/u/${encodeURIComponent(saved.handle)}`}
            className="shrink-0 rounded-full border border-[rgb(var(--accent-primary)/0.3)] bg-[rgb(var(--accent-primary)/0.1)] px-3 py-1.5 text-[11px] font-black tracking-[var(--ls-caps)] text-textPrimary"
          >
            View profile
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="text-sm text-textSecondary">Loading…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Handle</FieldLabel>
            <div className="flex items-center gap-1 rounded-card border border-white/10 bg-bgSecondary/35 px-3 py-2">
              <span className="text-sm text-textSecondary">@</span>
              <input
                value={handle}
                onChange={(e) => setHandle(sanitizeHandleInput(e.target.value))}
                placeholder="your-handle"
                className="w-full bg-transparent text-sm text-textPrimary outline-none placeholder:text-textSecondary/70"
              />
            </div>
            <span className="text-xs text-textSecondary/80">
              3–24 characters · letters, numbers, hyphens.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <FieldLabel>Bio</FieldLabel>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              rows={3}
              placeholder="What looks are you known for?"
              className="w-full resize-none rounded-card border border-white/10 bg-bgSecondary/35 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary/70"
            />
            <span className="text-xs text-textSecondary/80">
              {bio.length}/{BIO_MAX}
            </span>
          </label>

          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="min-w-0">
              <div className="text-sm font-bold text-textPrimary">
                Make my profile public
              </div>
              <div className="mt-0.5 text-xs text-textSecondary">
                {canGoPublic
                  ? 'Anyone with your handle can see your public looks.'
                  : 'Claim a handle first to go public.'}
              </div>
            </div>
            <ToggleSwitch
              checked={isPublic}
              onChange={setIsPublic}
              label="Make my profile public"
              size="md"
              disabled={!canGoPublic && !isPublic}
            />
          </div>

          {error ? (
            <div className="rounded-card border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-xs text-toneDanger">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="rounded-card border border-toneSuccess/30 bg-toneSuccess/10 px-3 py-2 text-xs text-toneSuccess">
              {success}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !dirty}
              className="rounded-full bg-accentPrimary px-5 py-2 text-sm font-bold text-bgPrimary transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
