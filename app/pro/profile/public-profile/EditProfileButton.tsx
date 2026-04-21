// app/pro/profile/public-profile/EditProfileButton.tsx
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

import { asTrimmedString, type UnknownRecord } from '@/lib/guards'
import { errorMessageFromUnknown, readErrorMessage, safeJson } from '@/lib/http'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { withCacheBuster } from '@/lib/url'

type Props = {
  canEditHandle: boolean
  initial: {
    businessName: string | null
    bio: string | null
    location: string | null
    avatarUrl: string | null
    professionType: string | null
    handle: string | null
    isPremium: boolean
  }
}

type TimeoutHandle = ReturnType<typeof setTimeout>

function normalizeHandleClientPreview(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

function readString(obj: UnknownRecord, key: string) {
  return asTrimmedString(obj[key])
}

function readNumber(obj: UnknownRecord, key: string) {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clearTimer(ref: React.MutableRefObject<TimeoutHandle | null>) {
  if (ref.current !== null) {
    clearTimeout(ref.current)
    ref.current = null
  }
}

export default function EditProfileButton({ canEditHandle, initial }: Props) {
  const router = useRouter()
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  const mountTimerRef = useRef<TimeoutHandle | null>(null)
  const closeTimerRef = useRef<TimeoutHandle | null>(null)
  const savedFlashTimerRef = useRef<TimeoutHandle | null>(null)

  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)

  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [businessName, setBusinessName] = useState(initial.businessName ?? '')
  const [professionType, setProfessionType] = useState(
    initial.professionType ?? '',
  )
  const [location, setLocation] = useState(initial.location ?? '')
  const [bio, setBio] = useState(initial.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? '')
  const [handle, setHandle] = useState(initial.handle ?? '')

  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>('')
  const [avatarBroken, setAvatarBroken] = useState(false)

  const busy = saving || uploadingAvatar

  const clearAllTimers = useCallback(() => {
    clearTimer(mountTimerRef)
    clearTimer(closeTimerRef)
    clearTimer(savedFlashTimerRef)
  }, [])

  const beginClose = useCallback(() => {
    if (busy) return

    clearTimer(closeTimerRef)

    setClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setOpen(false)
      setClosing(false)
      setMounted(false)
      setSavedFlash(false)
      setError(null)
      setAvatarBroken(false)
      closeTimerRef.current = null
    }, 140)
  }, [busy])

  useEffect(() => {
    return () => {
      clearAllTimers()
    }
  }, [clearAllTimers])

  useEffect(() => {
    if (!open) return

    setMounted(false)
    clearTimer(mountTimerRef)

    mountTimerRef.current = setTimeout(() => {
      setMounted(true)
      mountTimerRef.current = null
    }, 10)

    return () => {
      clearTimer(mountTimerRef)
    }
  }, [open])

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview('')
      return
    }

    const objectUrl = URL.createObjectURL(avatarFile)
    setAvatarPreview(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [avatarFile])

  useEffect(() => {
    setAvatarBroken(false)
  }, [avatarPreview, avatarUrl])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        beginClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [beginClose, open])

  useEffect(() => {
    if (!open) return
    closeBtnRef.current?.focus()
  }, [open])

  const handlePreview = useMemo(
    () => normalizeHandleClientPreview(handle),
    [handle],
  )

  const vanityPreview = useMemo(() => {
    if (!handlePreview) return null
    return `${handlePreview}.tovis.me`
  }, [handlePreview])

  const avatarSrc = useMemo(() => {
    const value = (avatarPreview || avatarUrl || '').trim()
    return value || null
  }, [avatarPreview, avatarUrl])

  const showAvatarImage = Boolean(avatarSrc) && !avatarBroken
  const statusText = savedFlash
    ? 'Saved ✓'
    : uploadingAvatar
      ? 'Uploading…'
      : saving
        ? 'Saving…'
        : null

  async function uploadAvatarIfNeeded(): Promise<string> {
    if (!avatarFile) {
      return avatarUrl.trim()
    }

    setUploadingAvatar(true)
    setError(null)

    try {
      const signedRes = await fetch('/api/pro/uploads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          kind: 'AVATAR_PUBLIC',
          contentType: avatarFile.type,
          size: avatarFile.size,
        }),
      })

      const signedRaw = await safeJson(signedRes)

      if (!signedRes.ok) {
        throw new Error(
          readErrorMessage(signedRaw) ??
            `Failed to init avatar upload (${signedRes.status})`,
        )
      }

      const responseRecord =
        signedRaw && typeof signedRaw === 'object'
          ? (signedRaw as UnknownRecord)
          : null

      const bucket = responseRecord ? readString(responseRecord, 'bucket') : null
      const path = responseRecord ? readString(responseRecord, 'path') : null
      const token = responseRecord ? readString(responseRecord, 'token') : null
      const publicUrl = responseRecord
        ? readString(responseRecord, 'publicUrl')
        : null
      const cacheBuster = responseRecord
        ? readNumber(responseRecord, 'cacheBuster') ?? Date.now()
        : Date.now()

      if (!bucket || !path || !token) {
        throw new Error('Upload init missing bucket/path/token.')
      }

      if (!publicUrl) {
        throw new Error(
          'Avatar upload must be public but no publicUrl was returned.',
        )
      }

      const uploadResult = await supabaseBrowser.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, avatarFile, {
          contentType: avatarFile.type,
          upsert: true,
        })

      if (uploadResult.error) {
        throw new Error(uploadResult.error.message || 'Avatar upload failed')
      }

      return withCacheBuster(publicUrl, cacheBuster)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function save() {
    try {
      setSaving(true)
      setError(null)

      const nextAvatarUrl = await uploadAvatarIfNeeded()

      const response = await fetch('/api/pro/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          businessName,
          professionType,
          location,
          bio,
          avatarUrl: nextAvatarUrl,
          ...(canEditHandle ? { handle } : {}),
        }),
      })

      const data = await safeJson(response)

      if (!response.ok) {
        throw new Error(readErrorMessage(data) ?? 'Failed to save')
      }

      setAvatarUrl(nextAvatarUrl)
      setSavedFlash(true)
      setAvatarFile(null)
      setAvatarPreview('')

      clearTimer(savedFlashTimerRef)
      clearTimer(closeTimerRef)

      router.refresh()

      closeTimerRef.current = setTimeout(() => {
        beginClose()
      }, 250)
    } catch (error: unknown) {
      setError(errorMessageFromUnknown(error))
    } finally {
      setSaving(false)

      clearTimer(savedFlashTimerRef)
      savedFlashTimerRef.current = setTimeout(() => {
        setSavedFlash(false)
        savedFlashTimerRef.current = null
      }, 800)
    }
  }

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
          aria-label="Edit profile"
          className={[
            'fixed inset-0 z-[1000] grid place-items-center p-4',
            'bg-black/70 backdrop-blur-sm',
            'transition-opacity duration-150 ease-out',
            mounted && !closing ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              beginClose()
            }
          }}
        >
          <div
            className={[
              'tovis-glass w-full max-w-130 max-h-[85vh] overflow-y-auto rounded-card border border-white/10 bg-bgSecondary p-4',
              'transform-gpu transition-all duration-150 ease-out',
              mounted && !closing
                ? 'translate-y-0 scale-100 opacity-100'
                : 'translate-y-2 scale-[0.985] opacity-0',
            ].join(' ')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-black text-textPrimary">
                Edit profile
              </div>

              <button
                ref={closeBtnRef}
                type="button"
                onClick={beginClose}
                className={[
                  'grid h-9 w-9 place-items-center rounded-full border text-[14px] font-black',
                  busy
                    ? 'cursor-not-allowed border-white/10 text-textSecondary opacity-70'
                    : 'border-white/10 text-textPrimary hover:border-white/20',
                ].join(' ')}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <Field label="Handle (vanity link)">
                <div className="grid gap-2">
                  <input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:cursor-not-allowed disabled:opacity-70"
                    placeholder="e.g. tori"
                    disabled={busy || !canEditHandle}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                  />

                  <div className="rounded-xl border border-white/10 bg-bgPrimary/40 px-3 py-2 text-[12px] text-textSecondary">
                    {canEditHandle ? (
                      vanityPreview ? (
                        <>
                          Vanity link:{' '}
                          <span className="font-black text-textPrimary">
                            {vanityPreview}
                          </span>
                          <span className="ml-2">
                            {initial.isPremium ? (
                              <span className="font-black text-textPrimary">
                                Active
                              </span>
                            ) : (
                              <span className="font-black text-textSecondary">
                                Reserved (Premium required)
                              </span>
                            )}
                          </span>
                        </>
                      ) : (
                        <>Pick a handle to preview your vanity link.</>
                      )
                    ) : (
                      <>
                        Your public profile link unlocks after approval. You can
                        finish the rest of your profile now.
                      </>
                    )}
                  </div>

                  {canEditHandle && !initial.isPremium ? (
                    <div className="text-[11px] text-textSecondary">
                      You can reserve a handle now. Your{' '}
                      <span className="font-black text-textPrimary">
                        .tovis.me
                      </span>{' '}
                      link activates after upgrading.
                    </div>
                  ) : null}

                  <div className="text-[11px] text-textSecondary">
                    Allowed: letters, numbers, hyphens. No spaces. Must
                    start/end with a letter or number.
                  </div>
                </div>
              </Field>

              <Field label="Business name">
                <input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="e.g. Lumara Beauty"
                  disabled={busy}
                />
              </Field>

              <Field label="Profession type">
                <input
                  value={professionType}
                  onChange={(event) => setProfessionType(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="e.g. MAKEUP_ARTIST"
                  disabled={busy}
                />
              </Field>

              <Field label="Location">
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="e.g. San Diego, CA"
                  disabled={busy}
                />
              </Field>

              <Field label="Avatar">
                <div className="grid gap-2">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 overflow-hidden rounded-full border border-white/10 bg-bgPrimary">
                      {showAvatarImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarSrc ?? undefined}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={() => setAvatarBroken(true)}
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[12px] font-black text-textSecondary">
                          🙂
                        </div>
                      )}
                    </div>

                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        setAvatarFile(event.target.files?.[0] ?? null)
                      }
                      disabled={busy}
                      className="text-[12px] text-textPrimary"
                    />
                  </div>

                  <div className="text-[11px] text-textSecondary">
                    Selecting a file does not upload yet. Upload happens when
                    you click{' '}
                    <span className="font-black text-textPrimary">Save</span>.
                  </div>

                  <input
                    value={avatarUrl}
                    onChange={(event) => setAvatarUrl(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                    placeholder="Avatar URL (fallback)"
                    disabled={busy}
                  />
                </div>
              </Field>

              <Field label="Bio">
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="Short, confident, clear."
                  disabled={busy}
                />
              </Field>

              {error ? (
                <div className="text-[12px] text-toneDanger">{error}</div>
              ) : null}

              <div className="mt-1 flex items-center justify-end gap-3">
                {statusText ? (
                  <div className="text-[12px] font-black text-textSecondary">
                    {statusText}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={beginClose}
                  disabled={busy}
                  className={[
                    'rounded-card border px-4 py-3 text-[13px] font-black transition',
                    busy
                      ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                      : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
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
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-2">
      <div className="text-[12px] font-black text-textSecondary">{label}</div>
      {children}
    </label>
  )
}