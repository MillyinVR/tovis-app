// app/pro/profile/public-profile/EditProfileButton.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

type Props = {
  initial: {
    businessName: string | null
    bio: string | null
    location: string | null
    avatarUrl: string | null
    professionType: string | null
  }
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function withCacheBust(url: string, v: number) {
  if (!url) return url
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}v=${encodeURIComponent(String(v))}`
}

export default function EditProfileButton({ initial }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [businessName, setBusinessName] = useState(initial.businessName ?? '')
  const [professionType, setProfessionType] = useState(initial.professionType ?? '')
  const [location, setLocation] = useState(initial.location ?? '')
  const [bio, setBio] = useState(initial.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? '')

  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    if (!avatarFile) return
    const url = URL.createObjectURL(avatarFile)
    setAvatarPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  async function uploadAvatarIfNeeded(): Promise<string> {
    if (!avatarFile) return avatarUrl

    setUploadingAvatar(true)
    setError(null)

    try {
      // 1) signed upload init
      const signedRes = await fetch('/api/pro/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'AVATAR_PUBLIC',
          contentType: avatarFile.type,
          size: avatarFile.size,
        }),
      })

      const signed = await safeJson(signedRes)
      if (!signedRes.ok) throw new Error(signed?.error || `Failed to init avatar upload (${signedRes.status})`)

      const bucket = pickString(signed?.bucket)
      const path = pickString(signed?.path)
      const token = pickString(signed?.token)
      const publicUrl = pickString(signed?.publicUrl)
      const cacheBuster = typeof signed?.cacheBuster === 'number' ? signed.cacheBuster : Date.now()

      if (!bucket || !path || !token) throw new Error('Upload init missing bucket/path/token.')
      if (!publicUrl) throw new Error('Avatar upload must be public but no publicUrl was returned.')

      // 2) upload file to signed path
      const up = await supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, avatarFile, {
        contentType: avatarFile.type,
        upsert: true, // stable path requires overwrite
      })

      if (up.error) throw new Error(up.error.message || 'Avatar upload failed')

      // 3) cache bust so UI updates instantly even though storage path is stable
      return withCacheBust(publicUrl, cacheBuster)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function save() {
    try {
      setSaving(true)
      setError(null)

      const nextAvatarUrl = await uploadAvatarIfNeeded()

      const res = await fetch('/api/pro/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          professionType,
          location,
          bio,
          avatarUrl: nextAvatarUrl,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to save')

      setAvatarFile(null)
      setAvatarPreview('')
      setAvatarUrl(nextAvatarUrl)

      setOpen(false)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || uploadingAvatar

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
      >
        Edit
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-999 grid place-items-center bg-black/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="tovis-glass w-full max-w-130 rounded-card border border-white/10 bg-bgSecondary p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-black text-textPrimary">Edit profile</div>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                className={[
                  'grid h-9 w-9 place-items-center rounded-full border text-[14px] font-black',
                  busy ? 'cursor-not-allowed border-white/10 text-textSecondary opacity-70' : 'border-white/10 text-textPrimary hover:border-white/20',
                ].join(' ')}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <Field label="Business name">
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="e.g. Lumara Beauty"
                  disabled={busy}
                />
              </Field>

              <Field label="Profession type">
                <input
                  value={professionType}
                  onChange={(e) => setProfessionType(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="e.g. MAKEUP_ARTIST"
                  disabled={busy}
                />
              </Field>

              <Field label="Location">
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="e.g. San Diego, CA"
                  disabled={busy}
                />
              </Field>

              <Field label="Avatar">
                <div className="grid gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 overflow-hidden rounded-full border border-white/10 bg-bgPrimary">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={avatarPreview || avatarUrl || ''}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          // hide broken image if empty
                          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                        }}
                      />
                      {!avatarPreview && !avatarUrl ? (
                        <div className="grid h-full w-full place-items-center text-[12px] font-black text-textSecondary">🙂</div>
                      ) : null}
                    </div>

                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                      disabled={busy}
                      className="text-[12px] text-textPrimary"
                    />
                  </div>

                  <div className="text-[11px] text-textSecondary">
                    Uploading a file overwrites the avatar at a stable storage path. The URL gets cache-busted automatically.
                  </div>

                  <input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                    placeholder="Avatar URL (fallback)"
                    disabled={busy}
                  />
                </div>
              </Field>

              <Field label="Bio">
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="Short, confident, clear."
                  disabled={busy}
                />
              </Field>

              {error ? <div className="text-[12px] text-toneDanger">{error}</div> : null}

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => !busy && setOpen(false)}
                  disabled={busy}
                  className={[
                    'rounded-card border px-4 py-3 text-[13px] font-black transition',
                    busy ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70' : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
                  ].join(' ')}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className={[
                    'rounded-card border px-4 py-3 text-[13px] font-black transition',
                    busy
                      ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                      : 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                  ].join(' ')}
                >
                  {uploadingAvatar ? 'Uploading…' : saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <div className="text-[12px] font-black text-textSecondary">{label}</div>
      {children}
    </label>
  )
}
