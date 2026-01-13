// app/pro/services/OfferingManager.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

type Offering = {
  id: string
  serviceId: string

  title: string | null // legacy compatibility only
  description: string | null

  customImageUrl: string | null
  serviceDefaultImageUrl?: string | null
  defaultImageUrl?: string | null

  serviceName: string
  categoryName: string | null

  minPrice: string // "49.99"

  offersInSalon: boolean
  offersMobile: boolean

  salonPriceStartingAt: string | null
  salonDurationMinutes: number | null

  mobilePriceStartingAt: string | null
  mobileDurationMinutes: number | null
}

type Props = {
  initialOfferings: Offering[]
  enforceCanonicalServiceNames?: boolean
  enableServiceImageUpload?: boolean
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function isValidMoneyString(v: string) {
  return /^\d+(\.\d{1,2})?$/.test(v.trim())
}

function normalizeMoney2(v: string) {
  const s = v.trim()
  if (!isValidMoneyString(s)) return null
  const [a, b = ''] = s.split('.')
  if (b.length === 0) return `${a}.00`
  if (b.length === 1) return `${a}.${b}0`
  return `${a}.${b}`
}

function moneyToCents(v: string) {
  const n = normalizeMoney2(v)
  if (!n) return null
  const [a, b] = n.split('.')
  return parseInt(a, 10) * 100 + parseInt(b, 10)
}

function pickImage(o: Offering) {
  const src = (o.customImageUrl || o.serviceDefaultImageUrl || o.defaultImageUrl || '').trim()
  return src || null
}

function imageLabel(o: Offering) {
  if (o.customImageUrl) return 'Custom'
  if (o.serviceDefaultImageUrl || o.defaultImageUrl) return 'Default'
  return 'None'
}

export default function OfferingManager({
  initialOfferings,
  enforceCanonicalServiceNames = true,
  enableServiceImageUpload = true,
}: Props) {
  const router = useRouter()
  const offerings = useMemo(() => initialOfferings ?? [], [initialOfferings])

  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null)
  const [errorById, setErrorById] = useState<Record<string, string | null>>({})
  const [successById, setSuccessById] = useState<Record<string, string | null>>({})

  function clearMessages(id: string) {
    setErrorById((m) => ({ ...m, [id]: null }))
    setSuccessById((m) => ({ ...m, [id]: null }))
  }

  async function saveOffering(offeringId: string, patch: any) {
    setBusyId(offeringId)
    clearMessages(offeringId)
    try {
      const res = await fetch(`/api/pro/offerings/${offeringId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        setErrorById((m) => ({ ...m, [offeringId]: data?.error || `Save failed (${res.status})` }))
        return
      }
      setSuccessById((m) => ({ ...m, [offeringId]: 'Saved.' }))
      router.refresh()
      setOpenId(null)
    } catch {
      setErrorById((m) => ({ ...m, [offeringId]: 'Network error while saving.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function removeOffering(offeringId: string) {
    setBusyId(offeringId)
    clearMessages(offeringId)
    try {
      const res = await fetch(`/api/pro/offerings/${offeringId}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) {
        setErrorById((m) => ({ ...m, [offeringId]: data?.error || `Remove failed (${res.status})` }))
        return
      }
      router.refresh()
      if (openId === offeringId) setOpenId(null)
    } catch {
      setErrorById((m) => ({ ...m, [offeringId]: 'Network error while removing.' }))
    } finally {
      setBusyId(null)
    }
  }

  async function uploadServiceImage(o: Offering, file: File) {
    setUploadBusyId(o.id)
    clearMessages(o.id)

    try {
      const initRes = await fetch('/api/pro/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'SERVICE_IMAGE_PUBLIC',
          serviceId: o.serviceId,
          contentType: file.type,
          size: file.size,
        }),
      })

      const init = await safeJson(initRes)
      if (!initRes.ok) throw new Error(init?.error || `Upload init failed (${initRes.status})`)

      const bucket = pickString(init?.bucket)
      const path = pickString(init?.path)
      const token = pickString(init?.token)
      const publicUrl = pickString(init?.publicUrl)

      if (!bucket || !path || !token) throw new Error('Upload init missing bucket/path/token.')
      if (!publicUrl) throw new Error('Service image must be public but no publicUrl was returned.')

      const { error: upErr } = await supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, {
        contentType: file.type,
        upsert: true,
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')

      await saveOffering(o.id, { customImageUrl: publicUrl })
      setSuccessById((m) => ({ ...m, [o.id]: 'Image updated.' }))
    } catch (e: any) {
      setErrorById((m) => ({ ...m, [o.id]: e?.message || 'Failed to upload image.' }))
    } finally {
      setUploadBusyId(null)
    }
  }

  return (
    <div className="grid gap-3">
      {offerings.map((o) => (
        <OfferingCard
          key={o.id}
          offering={o}
          enforceCanonicalServiceNames={enforceCanonicalServiceNames}
          enableServiceImageUpload={enableServiceImageUpload}
          isOpen={openId === o.id}
          busy={busyId === o.id}
          uploadBusy={uploadBusyId === o.id}
          error={errorById[o.id] ?? null}
          success={successById[o.id] ?? null}
          onToggle={() => {
            clearMessages(o.id)
            setOpenId((cur) => (cur === o.id ? null : o.id))
          }}
          onSave={(patch) => saveOffering(o.id, patch)}
          onRemove={() => removeOffering(o.id)}
          onUpload={(file) => uploadServiceImage(o, file)}
        />
      ))}
    </div>
  )
}

function OfferingCard(props: {
  offering: Offering
  enforceCanonicalServiceNames: boolean
  enableServiceImageUpload: boolean
  isOpen: boolean
  busy: boolean
  uploadBusy: boolean
  error: string | null
  success: string | null
  onToggle: () => void
  onSave: (patch: {
    description?: string | null
    customImageUrl?: string | null
    offersInSalon?: boolean
    offersMobile?: boolean
    salonPriceStartingAt?: string | null
    salonDurationMinutes?: number | null
    mobilePriceStartingAt?: string | null
    mobileDurationMinutes?: number | null
  }) => void
  onRemove: () => void
  onUpload: (file: File) => void
}) {
  const {
    offering: o,
    enforceCanonicalServiceNames,
    enableServiceImageUpload,
    isOpen,
    busy,
    uploadBusy,
    error,
    success,
    onToggle,
    onSave,
    onRemove,
    onUpload,
  } = props

  const fileRef = useRef<HTMLInputElement | null>(null)

  const displayName = enforceCanonicalServiceNames ? o.serviceName : o.title || o.serviceName
  const imgSrc = pickImage(o)

  const [description, setDescription] = useState(o.description ?? '')
  const [offersInSalon, setOffersInSalon] = useState(Boolean(o.offersInSalon))
  const [offersMobile, setOffersMobile] = useState(Boolean(o.offersMobile))
  const [salonPrice, setSalonPrice] = useState(o.salonPriceStartingAt ?? '')
  const [salonDuration, setSalonDuration] = useState(o.salonDurationMinutes ? String(o.salonDurationMinutes) : '')
  const [mobilePrice, setMobilePrice] = useState(o.mobilePriceStartingAt ?? '')
  const [mobileDuration, setMobileDuration] = useState(o.mobileDurationMinutes ? String(o.mobileDurationMinutes) : '')

  useEffect(() => {
    if (!isOpen) return
    setDescription(o.description ?? '')
    setOffersInSalon(Boolean(o.offersInSalon))
    setOffersMobile(Boolean(o.offersMobile))
    setSalonPrice(o.salonPriceStartingAt ?? '')
    setSalonDuration(o.salonDurationMinutes ? String(o.salonDurationMinutes) : '')
    setMobilePrice(o.mobilePriceStartingAt ?? '')
    setMobileDuration(o.mobileDurationMinutes ? String(o.mobileDurationMinutes) : '')
  }, [isOpen, o])

  function summaryLine() {
    const parts: string[] = []
    if (o.offersInSalon && o.salonPriceStartingAt && o.salonDurationMinutes) {
      parts.push(`Salon: $${o.salonPriceStartingAt} • ${o.salonDurationMinutes}m`)
    }
    if (o.offersMobile && o.mobilePriceStartingAt && o.mobileDurationMinutes) {
      parts.push(`Mobile: $${o.mobilePriceStartingAt} • ${o.mobileDurationMinutes}m`)
    }
    return parts.length ? parts.join('  ·  ') : 'No pricing set'
  }

  const inputBase =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40'

  return (
    <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-bgPrimary">
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-[10px] font-black text-textSecondary">NO IMAGE</div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-black text-textPrimary">{displayName}</div>
            {o.categoryName ? <div className="mt-0.5 text-[12px] font-black text-textSecondary">{o.categoryName}</div> : null}
            <div className="mt-2 text-[12px] text-textSecondary">{summaryLine()}</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Min price: <span className="font-black text-textPrimary">${normalizeMoney2(o.minPrice) ?? o.minPrice}</span>
              <span className="ml-2 rounded-full border border-white/10 bg-bgPrimary px-2 py-0.5 text-[10px] font-black text-textSecondary">
                Image: {imageLabel(o)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onToggle}
              disabled={busy || uploadBusy}
              className={[
                'rounded-full border px-3 py-2 text-[12px] font-black transition',
                busy || uploadBusy
                  ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                  : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
              ].join(' ')}
            >
              {isOpen ? 'Close' : 'Edit'}
            </button>

            <button
              type="button"
              onClick={onRemove}
              disabled={busy || uploadBusy}
              className={[
                'rounded-full border px-3 py-2 text-[12px] font-black transition',
                busy || uploadBusy
                  ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                  : 'border-toneDanger/40 bg-bgPrimary text-toneDanger hover:border-toneDanger/60',
              ].join(' ')}
            >
              {busy ? 'Working…' : 'Remove'}
            </button>
          </div>

          {enableServiceImageUpload ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  if (!f) return
                  onUpload(f)
                  e.currentTarget.value = ''
                }}
              />

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || uploadBusy}
                className={[
                  'rounded-full border px-3 py-2 text-[12px] font-black transition',
                  busy || uploadBusy
                    ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                    : 'border-accentPrimary/40 bg-bgPrimary text-textPrimary hover:border-accentPrimary/70',
                ].join(' ')}
              >
                {uploadBusy ? 'Uploading…' : 'Upload image'}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <form
          className="mt-4 grid gap-3 border-t border-white/10 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!offersInSalon && !offersMobile) return alert('Enable at least Salon or Mobile.')

            const minCents = moneyToCents(o.minPrice) ?? 0

            let salonPriceNorm: string | null = null
            let salonDurInt: number | null = null
            if (offersInSalon) {
              salonPriceNorm = normalizeMoney2(salonPrice)
              if (!salonPriceNorm) return alert('Salon price must be like 50 or 49.99')
              const salonCents = moneyToCents(salonPriceNorm)
              if (salonCents == null || salonCents < minCents) {
                return alert(`Salon price must be at least $${normalizeMoney2(o.minPrice) ?? o.minPrice}`)
              }
              salonDurInt = Math.trunc(Number(salonDuration))
              if (!Number.isFinite(salonDurInt) || salonDurInt <= 0) return alert('Salon duration must be a positive number.')
            }

            let mobilePriceNorm: string | null = null
            let mobileDurInt: number | null = null
            if (offersMobile) {
              mobilePriceNorm = normalizeMoney2(mobilePrice)
              if (!mobilePriceNorm) return alert('Mobile price must be like 50 or 49.99')
              const mobileCents = moneyToCents(mobilePriceNorm)
              if (mobileCents == null || mobileCents < minCents) {
                return alert(`Mobile price must be at least $${normalizeMoney2(o.minPrice) ?? o.minPrice}`)
              }
              mobileDurInt = Math.trunc(Number(mobileDuration))
              if (!Number.isFinite(mobileDurInt) || mobileDurInt <= 0) return alert('Mobile duration must be a positive number.')
            }

            onSave({
              description: description.trim() || null,
              offersInSalon,
              offersMobile,
              salonPriceStartingAt: offersInSalon ? salonPriceNorm : null,
              salonDurationMinutes: offersInSalon ? salonDurInt : null,
              mobilePriceStartingAt: offersMobile ? mobilePriceNorm : null,
              mobileDurationMinutes: offersMobile ? mobileDurInt : null,
            })
          }}
        >
          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Description (optional)</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy || uploadBusy}
              rows={3}
              className={inputBase}
              placeholder="Short, clear, client-friendly."
            />
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
              <input
                type="checkbox"
                checked={offersInSalon}
                onChange={(e) => setOffersInSalon(e.target.checked)}
                disabled={busy || uploadBusy}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
              />
              Offer in Salon
            </label>

            <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
              <input
                type="checkbox"
                checked={offersMobile}
                onChange={(e) => setOffersMobile(e.target.checked)}
                disabled={busy || uploadBusy}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
              />
              Offer Mobile
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className={['rounded-card border border-white/10 bg-bgPrimary p-3', offersInSalon ? '' : 'opacity-70'].join(' ')}>
              <div className="mb-2 text-[12px] font-black text-textPrimary">Salon</div>
              <div className="grid gap-2">
                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Starting at</div>
                  <input
                    value={salonPrice}
                    onChange={(e) => setSalonPrice(e.target.value)}
                    disabled={busy || uploadBusy || !offersInSalon}
                    inputMode="decimal"
                    className={inputBase}
                  />
                </label>

                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Minutes</div>
                  <input
                    value={salonDuration}
                    onChange={(e) => setSalonDuration(e.target.value)}
                    disabled={busy || uploadBusy || !offersInSalon}
                    type="number"
                    min={1}
                    className={inputBase}
                  />
                </label>
              </div>
            </div>

            <div className={['rounded-card border border-white/10 bg-bgPrimary p-3', offersMobile ? '' : 'opacity-70'].join(' ')}>
              <div className="mb-2 text-[12px] font-black text-textPrimary">Mobile</div>
              <div className="grid gap-2">
                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Starting at</div>
                  <input
                    value={mobilePrice}
                    onChange={(e) => setMobilePrice(e.target.value)}
                    disabled={busy || uploadBusy || !offersMobile}
                    inputMode="decimal"
                    className={inputBase}
                  />
                </label>

                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Minutes</div>
                  <input
                    value={mobileDuration}
                    onChange={(e) => setMobileDuration(e.target.value)}
                    disabled={busy || uploadBusy || !offersMobile}
                    type="number"
                    min={1}
                    className={inputBase}
                  />
                </label>
              </div>
            </div>
          </div>

          {error ? <div className="text-[12px] text-toneDanger">{error}</div> : null}
          {success ? <div className="text-[12px] text-toneSuccess">{success}</div> : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || uploadBusy}
              className={[
                'rounded-card border px-4 py-3 text-[13px] font-black transition',
                busy || uploadBusy
                  ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                  : 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              ].join(' ')}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
