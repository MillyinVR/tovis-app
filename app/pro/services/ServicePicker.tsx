// app/pro/services/ServicePicker.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

type ServiceDTO = {
  id: string
  name: string
  minPrice: string // dollars "49.99"
  defaultDurationMinutes: number
  defaultImageUrl?: string | null

  // ✅ add-on flags (read-only in pro UI)
  isAddOnEligible: boolean
  addOnGroup?: string | null
}

type CategoryDTO = {
  id: string
  name: string
  services: ServiceDTO[]
  children: {
    id: string
    name: string
    services: ServiceDTO[]
  }[]
}

type OfferingDTO = {
  id: string
  serviceId: string
}

type Props = {
  categories: CategoryDTO[]
  offerings: OfferingDTO[]
}

// ---------- money helpers ----------
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

function moneyToCentsInt(v: string) {
  const n = normalizeMoney2(v)
  if (!n) return null
  const [a, b] = n.split('.')
  return parseInt(a, 10) * 100 + parseInt(b, 10)
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

export default function ServicePicker({ categories, offerings }: Props) {
  const router = useRouter()

  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')

  const [description, setDescription] = useState('')
  const [offersInSalon, setOffersInSalon] = useState(true)
  const [offersMobile, setOffersMobile] = useState(false)

  const [salonPrice, setSalonPrice] = useState('')
  const [salonDuration, setSalonDuration] = useState('')

  const [mobilePrice, setMobilePrice] = useState('')
  const [mobileDuration, setMobileDuration] = useState('')

  const [serviceImageUrl, setServiceImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) || null,
    [categories, selectedCategoryId],
  )

  const selectedSubcategory = useMemo(() => {
    if (!selectedCategory) return null
    if (!selectedSubcategoryId) return null
    return selectedCategory.children.find((c) => c.id === selectedSubcategoryId) || null
  }, [selectedCategory, selectedSubcategoryId])

  const servicesForSelection: ServiceDTO[] = useMemo(() => {
    if (selectedSubcategory) return selectedSubcategory.services
    if (selectedCategory) return [...selectedCategory.services, ...selectedCategory.children.flatMap((c) => c.services)]
    return []
  }, [selectedCategory, selectedSubcategory])

  const selectedService = useMemo(
    () => servicesForSelection.find((s) => s.id === selectedServiceId) || null,
    [servicesForSelection, selectedServiceId],
  )

  const existingServiceIds = useMemo(() => new Set(offerings.map((o) => o.serviceId)), [offerings])
  const alreadyAdded = selectedService ? existingServiceIds.has(selectedService.id) : false

  function resetAll() {
    setDescription('')
    setOffersInSalon(true)
    setOffersMobile(false)
    setSalonPrice('')
    setSalonDuration('')
    setMobilePrice('')
    setMobileDuration('')
    setServiceImageUrl(null)
    setSuccess(null)
    setError(null)
  }

  function resetFormForService(service: ServiceDTO | null) {
    setServiceImageUrl(null)

    if (!service) {
      resetAll()
      return
    }

    setDescription('')
    setOffersInSalon(true)
    setOffersMobile(false)

    const p = normalizeMoney2(service.minPrice) ?? service.minPrice
    const d = String(service.defaultDurationMinutes || 60)

    setSalonPrice(p)
    setSalonDuration(d)
    setMobilePrice(p)
    setMobileDuration(d)

    setSuccess(null)
    setError(null)
  }

  function handleCategoryChange(id: string) {
    setSelectedCategoryId(id)
    setSelectedSubcategoryId('')
    setSelectedServiceId('')
    resetFormForService(null)
  }

  function handleSubcategoryChange(id: string) {
    setSelectedSubcategoryId(id)
    setSelectedServiceId('')
    resetFormForService(null)
  }

  function handleServiceChange(id: string) {
    setSelectedServiceId(id)
    const svc = servicesForSelection.find((s) => s.id === id) || null
    resetFormForService(svc)
  }

  function validatePriceMin(priceNorm: string, minPrice: string, label: 'Salon' | 'Mobile') {
    const enteredCents = moneyToCentsInt(priceNorm)
    const minCents = moneyToCentsInt(minPrice)
    if (enteredCents === null || minCents === null) return `Invalid ${label} price configuration.`
    if (enteredCents < minCents) return `${label} price must be at least $${normalizeMoney2(minPrice) ?? minPrice}.`
    return null
  }

  async function uploadServiceImage(file: File) {
    if (!selectedService) {
      setError('Pick a service first, then upload an image.')
      return
    }

    setError(null)
    setSuccess(null)
    setUploadingImage(true)

    try {
      const initRes = await fetch('/api/pro/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'SERVICE_IMAGE_PUBLIC',
          serviceId: selectedService.id,
          contentType: file.type,
          size: file.size,
        }),
      })

      const init = await safeJson(initRes)
      if (!initRes.ok) {
        setError(init?.error || 'Failed to prepare upload.')
        return
      }

      const bucket = pickString(init?.bucket)
      const path = pickString(init?.path)
      const token = pickString(init?.token)
      const publicUrl = pickString(init?.publicUrl)
      const cacheBuster = typeof init?.cacheBuster === 'number' ? init.cacheBuster : null

      if (!bucket || !path || !token) {
        setError('Upload init missing bucket/path/token.')
        return
      }
      if (!publicUrl) {
        setError('Upload init missing publicUrl (this should be public).')
        return
      }

      const { error: upErr } = await supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, {
        contentType: file.type,
        upsert: true,
      })

      if (upErr) {
        setError(upErr.message || 'Upload failed.')
        return
      }

      const finalUrl = cacheBuster ? `${publicUrl}?v=${cacheBuster}` : publicUrl
      setServiceImageUrl(finalUrl)
      setSuccess('Image uploaded. It will be used once you add the service.')
    } catch (err) {
      console.error(err)
      setError('Network error during upload.')
    } finally {
      setUploadingImage(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setSuccess(null)

    if (!selectedService) return setError('Please choose a service from the library first.')
    if (alreadyAdded) return setError('You already added this service.')
    if (!offersInSalon && !offersMobile) return setError('Enable at least Salon or Mobile.')

    let salonPriceNorm: string | null = null
    let salonDurationInt: number | null = null
    if (offersInSalon) {
      salonPriceNorm = normalizeMoney2(salonPrice)
      if (!salonPriceNorm) return setError('Salon price must be a valid amount like 50 or 49.99')

      salonDurationInt = parseInt(salonDuration, 10)
      if (Number.isNaN(salonDurationInt) || salonDurationInt <= 0) {
        return setError('Salon duration must be a positive number of minutes.')
      }

      const minErr = validatePriceMin(salonPriceNorm, selectedService.minPrice, 'Salon')
      if (minErr) return setError(minErr)
    }

    let mobilePriceNorm: string | null = null
    let mobileDurationInt: number | null = null
    if (offersMobile) {
      mobilePriceNorm = normalizeMoney2(mobilePrice)
      if (!mobilePriceNorm) return setError('Mobile price must be a valid amount like 50 or 49.99')

      mobileDurationInt = parseInt(mobileDuration, 10)
      if (Number.isNaN(mobileDurationInt) || mobileDurationInt <= 0) {
        return setError('Mobile duration must be a positive number of minutes.')
      }

      const minErr = validatePriceMin(mobilePriceNorm, selectedService.minPrice, 'Mobile')
      if (minErr) return setError(minErr)
    }

    setLoading(true)
    try {
      const res = await fetch('/api/pro/offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedService.id,
          title: null,
          description: description.trim() || null,
          customImageUrl: serviceImageUrl,
          offersInSalon,
          offersMobile,
          salonPriceStartingAt: offersInSalon ? salonPriceNorm : null,
          salonDurationMinutes: offersInSalon ? salonDurationInt : null,
          mobilePriceStartingAt: offersMobile ? mobilePriceNorm : null,
          mobileDurationMinutes: offersMobile ? mobileDurationInt : null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) {
        setError(data?.error || 'Something went wrong while saving this service.')
        return
      }

      setSuccess('Service added to your menu.')
      router.refresh()

      // prevent accidental reuse
      setServiceImageUrl(null)
    } catch (err) {
      console.error(err)
      setError('Network error while saving service.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40'
  const selectClass =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40'

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary p-4">
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Main category</div>
            <select
              value={selectedCategoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className={selectClass}
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Subcategory</div>
            <select
              value={selectedSubcategoryId}
              onChange={(e) => handleSubcategoryChange(e.target.value)}
              disabled={!selectedCategory}
              className={[selectClass, !selectedCategory ? 'cursor-not-allowed opacity-60' : ''].join(' ')}
            >
              <option value="">All under this category</option>
              {selectedCategory?.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Service</div>
            <select
              value={selectedServiceId}
              onChange={(e) => handleServiceChange(e.target.value)}
              disabled={!selectedCategory}
              className={[selectClass, !selectedCategory ? 'cursor-not-allowed opacity-60' : ''].join(' ')}
            >
              <option value="">Select service</option>
              {servicesForSelection.map((s) => (
                <option key={s.id} value={s.id} disabled={existingServiceIds.has(s.id)}>
                  {s.name}
                  {s.isAddOnEligible ? (s.addOnGroup ? ` (Add-on: ${s.addOnGroup})` : ' (Add-on)') : ''}
                  {existingServiceIds.has(s.id) ? ' (added)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4 border-t border-white/10 pt-4">
          <div className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Service image (optional)</div>

            <div className="rounded-card border border-white/10 bg-bgSecondary p-3">
              <input
                type="file"
                accept="image/*"
                disabled={!selectedService || loading || uploadingImage}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  if (f) uploadServiceImage(f)
                  e.currentTarget.value = ''
                }}
                className="block w-full text-[12px] text-textSecondary file:mr-3 file:rounded-full file:border file:border-white/10 file:bg-bgPrimary file:px-3 file:py-2 file:text-[12px] file:font-black file:text-textPrimary hover:file:border-white/20"
              />

              <div className="mt-2 text-[12px] text-textSecondary">
                This image only overrides how this service displays on{' '}
                <span className="font-black text-textPrimary">your</span> menu.
              </div>

              {uploadingImage ? <div className="mt-2 text-[12px] text-textSecondary">Uploading…</div> : null}

              {serviceImageUrl ? (
                <div className="mt-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={serviceImageUrl}
                    alt="Service image preview"
                    className="h-16 w-16 rounded-xl border border-white/10 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setServiceImageUrl(null)}
                    disabled={loading || uploadingImage}
                    className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Description (optional)</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!selectedService || loading}
              rows={3}
              className={inputClass}
              placeholder="Short, clear, client-friendly."
            />
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
              <input
                type="checkbox"
                checked={offersInSalon}
                onChange={(e) => setOffersInSalon(e.target.checked)}
                disabled={!selectedService || loading}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
              />
              Offer in Salon
            </label>

            <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
              <input
                type="checkbox"
                checked={offersMobile}
                onChange={(e) => setOffersMobile(e.target.checked)}
                disabled={!selectedService || loading}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
              />
              Offer Mobile
            </label>

            {selectedService ? (
              <div className="text-[12px] text-textSecondary">
                Min price:{' '}
                <span className="font-black text-textPrimary">
                  ${normalizeMoney2(selectedService.minPrice) ?? selectedService.minPrice}
                </span>

                {selectedService.isAddOnEligible ? (
                  <span className="ml-2 rounded-full border border-white/10 bg-bgPrimary px-2 py-0.5 text-[10px] font-black text-textSecondary">
                    Add-on{selectedService.addOnGroup ? ` • ${selectedService.addOnGroup}` : ''}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div
              className={[
                'rounded-card border border-white/10 bg-bgSecondary p-3',
                offersInSalon ? '' : 'opacity-70',
              ].join(' ')}
            >
              <div className="mb-2 text-[12px] font-black text-textPrimary">Salon pricing</div>

              <div className="grid gap-2">
                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Starting at</div>
                  <input
                    value={salonPrice}
                    onChange={(e) => setSalonPrice(e.target.value)}
                    disabled={!selectedService || loading || !offersInSalon}
                    inputMode="decimal"
                    className={inputClass}
                    placeholder="e.g. 120 or 120.00"
                  />
                </label>

                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Duration (minutes)</div>
                  <input
                    value={salonDuration}
                    onChange={(e) => setSalonDuration(e.target.value)}
                    disabled={!selectedService || loading || !offersInSalon}
                    type="number"
                    min={1}
                    className={inputClass}
                    placeholder="e.g. 90"
                  />
                </label>
              </div>
            </div>

            <div
              className={[
                'rounded-card border border-white/10 bg-bgSecondary p-3',
                offersMobile ? '' : 'opacity-70',
              ].join(' ')}
            >
              <div className="mb-2 text-[12px] font-black text-textPrimary">Mobile pricing</div>

              <div className="grid gap-2">
                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Starting at</div>
                  <input
                    value={mobilePrice}
                    onChange={(e) => setMobilePrice(e.target.value)}
                    disabled={!selectedService || loading || !offersMobile}
                    inputMode="decimal"
                    className={inputClass}
                    placeholder="e.g. 150 or 150.00"
                  />
                </label>

                <label className="grid gap-1">
                  <div className="text-[11px] font-black text-textSecondary">Duration (minutes)</div>
                  <input
                    value={mobileDuration}
                    onChange={(e) => setMobileDuration(e.target.value)}
                    disabled={!selectedService || loading || !offersMobile}
                    type="number"
                    min={1}
                    className={inputClass}
                    placeholder="e.g. 90"
                  />
                </label>
              </div>
            </div>
          </div>

          {error ? <div className="text-[12px] text-toneDanger">{error}</div> : null}
          {success ? <div className="text-[12px] text-toneSuccess">{success}</div> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedCategoryId('')
                setSelectedSubcategoryId('')
                setSelectedServiceId('')
                resetFormForService(null)
              }}
              disabled={loading}
              className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
            >
              Reset
            </button>

            <button
              type="submit"
              disabled={loading || uploadingImage || !selectedService || alreadyAdded}
              className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
            >
              {loading ? 'Adding…' : alreadyAdded ? 'Already added' : 'Add to my menu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
