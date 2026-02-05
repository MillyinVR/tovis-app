// app/admin/services/_components/ServicesCreateWizard.tsx
'use client'

import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

type CategoryDTO = { id: string; name: string; parentId: string | null }

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function vibeTick(intensity: 'soft' | 'med' = 'soft') {
  try {
    const ms = intensity === 'med' ? 12 : 8
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms)
  } catch {
    // ignore
  }
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function withCacheBuster(url: string, cb?: number | null) {
  const cacheBuster = typeof cb === 'number' ? cb : Date.now()
  try {
    const u = new URL(url)
    u.searchParams.set('v', String(cacheBuster))
    return u.toString()
  } catch {
    const joiner = url.includes('?') ? '&' : '?'
    return `${url}${joiner}v=${cacheBuster}`
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-extrabold text-textSecondary">{children}</div>
}

/** ✅ forwardRef so ref={...} works */
const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  const { className, ...rest } = props
  return (
    <input
      ref={ref}
      {...rest}
      className={cx(
        'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary',
        'placeholder:text-textSecondary/70 outline-none',
        'focus:border-surfaceGlass/30',
        className,
      )}
    />
  )
})
Input.displayName = 'Input'

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props
  return (
    <select
      {...rest}
      className={cx(
        'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary',
        'outline-none focus:border-surfaceGlass/30',
        className,
      )}
    />
  )
}

function fmtCatLabel(cat: CategoryDTO, byId: Map<string, CategoryDTO>) {
  if (!cat.parentId) return cat.name
  const parent = byId.get(cat.parentId)
  return parent ? `${parent.name} → ${cat.name}` : `↳ ${cat.name}`
}

function isMoneyLike(s: string) {
  const v = s.trim()
  if (!v) return true
  return /^\d+(\.\d{1,2})?$/.test(v)
}

function isIntLike(s: string) {
  const v = s.trim()
  if (!v) return true
  return /^\d+$/.test(v)
}

function isImageFile(file: File | null) {
  if (!file) return true
  return file.type.startsWith('image/')
}

export default function ServicesCreateWizard(props: { categories: CategoryDTO[] }) {
  const { categories } = props
  const router = useRouter()

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const kidsByParent = useMemo(() => {
    const m = new Map<string, CategoryDTO[]>()
    for (const c of categories) {
      if (!c.parentId) continue
      const arr = m.get(c.parentId) ?? []
      arr.push(c)
      m.set(c.parentId, arr)
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name))
      m.set(k, arr)
    }
    return m
  }, [categories])

  const orderedOptions = useMemo(() => {
    const out: CategoryDTO[] = []
    const tops = categories
      .filter((c) => !c.parentId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const t of tops) {
      out.push(t)
      const kids = kidsByParent.get(t.id) ?? []
      for (const k of kids) out.push(k)
    }

    const seen = new Set(out.map((c) => c.id))
    for (const c of categories) if (!seen.has(c.id)) out.push(c)
    return out
  }, [categories, kidsByParent])

  const [step, setStep] = useState<1 | 2>(1)

  const [catSearch, setCatSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const [name, setName] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState('')
  const [allowMobile, setAllowMobile] = useState(false)

  const [imageFile, setImageFile] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const moneyOk = isMoneyLike(minPrice)
  const durationOk = isIntLike(defaultDurationMinutes)
  const imageOk = isImageFile(imageFile)

  const canGoNext = Boolean(categoryId)
  const canSubmit = Boolean(categoryId && name.trim() && moneyOk && durationOk && imageOk && !busy)

  useEffect(() => {
    if (step !== 2) return
    const t = window.setTimeout(() => nameRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [step])

  const filteredCategoryOptions = useMemo(() => {
    const q = catSearch.trim().toLowerCase()
    if (!q) return orderedOptions
    return orderedOptions.filter((c) => {
      const label = fmtCatLabel(c, byId).toLowerCase()
      return label.includes(q) || c.name.toLowerCase().includes(q)
    })
  }, [orderedOptions, catSearch, byId])

  const btnBase =
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-extrabold transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed'

  const btnSoft =
    'border border-surfaceGlass/15 bg-bgPrimary/30 text-textPrimary hover:bg-bgPrimary/40 hover:border-surfaceGlass/25'

  const btnAccent =
    'border border-accentPrimary/45 bg-accentPrimary/15 text-textPrimary hover:bg-accentPrimary/20 hover:border-accentPrimary/60 shadow-[0_18px_50px_rgb(0_0_0/0.35)]'

  async function createService(): Promise<{ id: string } | null> {
    const form = new FormData()
    form.set('categoryId', categoryId)
    form.set('name', name.trim())
    if (minPrice.trim()) form.set('minPrice', minPrice.trim())
    if (defaultDurationMinutes.trim()) form.set('defaultDurationMinutes', defaultDurationMinutes.trim())
    if (allowMobile) form.set('allowMobile', 'true')

    const res = await fetch('/api/admin/services?format=json', {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json' },
    })

    const data = await safeJson(res)
    if (!res.ok || data?.ok !== true || !data?.id) {
      setErr(data?.error || `Create failed (${res.status}).`)
      return null
    }

    return { id: String(data.id) }
  }

  async function uploadDefaultImageToSupabase(serviceId: string, file: File) {
    // 1) init signed upload (your /api/admin/uploads route)
    const initRes = await fetch('/api/admin/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC',
        serviceId,
        contentType: file.type,
        size: file.size,
      }),
    })

    const init = await safeJson(initRes)
    if (!initRes.ok || init?.ok !== true) {
      throw new Error(init?.error || `Upload init failed (${initRes.status}).`)
    }

    const bucket = String(init.bucket || '')
    const path = String(init.path || '')
    const token = String(init.token || '')
    const publicUrl = String(init.publicUrl || '')
    const cacheBuster = typeof init.cacheBuster === 'number' ? init.cacheBuster : null

    if (!bucket || !path || !token) throw new Error('Upload init missing bucket/path/token.')
    if (!publicUrl) throw new Error('Upload init missing publicUrl.')

    // 2) upload file to signed URL (Supabase)
    const { error: upErr } = await supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, {
      contentType: file.type,
      upsert: true,
    })
    if (upErr) throw new Error(upErr.message || 'Upload failed.')

    return withCacheBuster(publicUrl, cacheBuster)
  }

  async function attachDefaultImage(serviceId: string, finalUrl: string) {
    const patch = new FormData()
    patch.set('_method', 'PATCH')
    patch.set('defaultImageUrl', finalUrl)

    const res = await fetch(`/api/admin/services/${encodeURIComponent(serviceId)}`, {
      method: 'POST',
      body: patch,
      headers: { Accept: 'application/json' },
    })

    const data = await safeJson(res)
    if (!res.ok || data?.ok !== true) {
      throw new Error(data?.error || `Failed to attach image (${res.status}).`)
    }
  }

  async function onSubmit() {
    if (!canSubmit) return
    setBusy(true)
    setErr(null)

    try {
      vibeTick('med')

      const created = await createService()
      if (!created) return

      if (imageFile) {
        const finalUrl = await uploadDefaultImageToSupabase(created.id, imageFile)
        await attachDefaultImage(created.id, finalUrl)
      }

      // reset
      setStep(1)
      setCatSearch('')
      setCategoryId('')
      setName('')
      setMinPrice('')
      setDefaultDurationMinutes('')
      setAllowMobile(false)
      setImageFile(null)

      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-extrabold text-textPrimary">Create service</div>
          <div className="text-[11px] text-textSecondary">Create → optional image upload → persist immediately.</div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-surfaceGlass/12 bg-bgSecondary/60 px-3 py-1 text-[11px] font-extrabold text-textSecondary">
          <span className={cx('h-1.5 w-1.5 rounded-full', step === 1 ? 'bg-accentPrimary' : 'bg-surfaceGlass/35')} />
          Step {step} / 2
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {step === 1 ? (
          <div className="grid gap-3 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/25 p-3">
            <FieldLabel>Step 1 — Pick a category</FieldLabel>

            <Input
              value={catSearch}
              onChange={(e) => setCatSearch(e.target.value)}
              placeholder="Search categories…"
              autoComplete="off"
              inputMode="search"
              disabled={busy}
            />

            <Select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value)
                vibeTick('soft')
              }}
              required
              disabled={busy}
            >
              <option value="" disabled>
                Select category
              </option>
              {filteredCategoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? '↳ ' : ''}
                  {fmtCatLabel(c, byId)}
                </option>
              ))}
            </Select>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="text-[11px] text-textSecondary">
                Tip: pick the most specific category (like “Hair → Color”).
              </div>

              <button
                type="button"
                className={cx(btnBase, btnAccent)}
                disabled={!canGoNext || busy}
                onClick={() => {
                  if (!canGoNext || busy) return
                  setStep(2)
                  vibeTick('med')
                }}
              >
                Next
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 rounded-2xl border border-surfaceGlass/10 bg-bgPrimary/25 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <FieldLabel>Step 2 — Details</FieldLabel>
                <div className="text-[11px] text-textSecondary">
                  Category:{' '}
                  <span className="font-extrabold text-textPrimary">
                    {categoryId && byId.get(categoryId) ? fmtCatLabel(byId.get(categoryId)!, byId) : '—'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className={cx(btnBase, btnSoft)}
                onClick={() => {
                  setStep(1)
                  vibeTick('soft')
                }}
                disabled={busy}
              >
                ← Back
              </button>
            </div>

            <label className="grid gap-1">
              <div className="text-xs font-extrabold text-textSecondary">Service name</div>
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Balayage"
                autoComplete="off"
                disabled={busy}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <div className="text-xs font-extrabold text-textSecondary">Min price</div>
                <Input
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 45 or 45.00"
                  className={cx(!moneyOk && minPrice.trim() ? 'border-toneDanger/45' : '')}
                  disabled={busy}
                />
                {!moneyOk && minPrice.trim() ? (
                  <div className="text-[11px] font-extrabold text-toneDanger">Use numbers like 45 or 45.00</div>
                ) : null}
              </label>

              <label className="grid gap-1">
                <div className="text-xs font-extrabold text-textSecondary">Default minutes</div>
                <Input
                  value={defaultDurationMinutes}
                  onChange={(e) => setDefaultDurationMinutes(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 60"
                  className={cx(!durationOk && defaultDurationMinutes.trim() ? 'border-toneDanger/45' : '')}
                  disabled={busy}
                />
                {!durationOk && defaultDurationMinutes.trim() ? (
                  <div className="text-[11px] font-extrabold text-toneDanger">Whole minutes only (like 60)</div>
                ) : null}
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs font-black text-textPrimary">
              <input
                type="checkbox"
                checked={allowMobile}
                onChange={(e) => {
                  setAllowMobile(e.target.checked)
                  vibeTick('soft')
                }}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
                disabled={busy}
              />
              Allow mobile by default
            </label>

            <div className="grid gap-2 rounded-2xl border border-white/10 bg-bgPrimary/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="grid gap-0.5">
                  <div className="text-xs font-extrabold text-textSecondary">Default service image (optional)</div>
                  <div className="text-[11px] text-textSecondary">Will be persisted immediately after create.</div>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    setImageFile(f)
                    vibeTick('soft')
                    e.currentTarget.value = ''
                  }}
                  disabled={busy}
                />

                <button
                  type="button"
                  className={cx(btnBase, btnSoft)}
                  onClick={() => {
                    vibeTick('soft')
                    fileRef.current?.click()
                  }}
                  disabled={busy}
                >
                  {imageFile ? 'Change' : 'Upload'}
                </button>
              </div>

              {imageFile ? (
                <div className="text-[11px] text-textSecondary">
                  Selected: <span className="font-extrabold text-textPrimary">{imageFile.name}</span>
                </div>
              ) : (
                <div className="text-[11px] text-textSecondary">No image selected.</div>
              )}

              {!imageOk ? (
                <div className="text-[11px] font-extrabold text-toneDanger">That file isn’t an image.</div>
              ) : null}
            </div>

            {err ? <div className="text-sm text-toneDanger">{err}</div> : null}

            <div className="mt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                className={cx(btnBase, btnAccent, 'px-4')}
                disabled={!canSubmit}
                onClick={onSubmit}
                title={!canSubmit ? 'Pick category + enter a name (and fix invalid fields)' : 'Create service'}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
