'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type ServiceDTO = {
  id: string
  name: string
  minPrice: string // dollars, e.g. "49.99"
  defaultDurationMinutes: number
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
  title: string | null
  description?: string | null
  customImageUrl: string | null
  defaultImageUrl?: string | null
  serviceName: string
  categoryName: string | null

  offersInSalon: boolean
  offersMobile: boolean
  salonPriceStartingAt: string | null
  salonDurationMinutes: number | null
  mobilePriceStartingAt: string | null
  mobileDurationMinutes: number | null
}

type Props = {
  categories: CategoryDTO[]
  offerings: OfferingDTO[]
}

// ---------- money helpers (frontend only) ----------
function isValidMoneyString(v: string) {
  const s = v.trim()
  return /^\d+(\.\d{1,2})?$/.test(s)
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

export default function ServicePicker({ categories }: Props) {
  const router = useRouter()

  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')

  // overrides
  const [title, setTitle] = useState('')
  const [customImageUrl, setCustomImageUrl] = useState('')
  const [description, setDescription] = useState('')

  // location toggles
  const [offersInSalon, setOffersInSalon] = useState(true)
  const [offersMobile, setOffersMobile] = useState(false)

  // SALON fields
  const [salonPrice, setSalonPrice] = useState<string>('') // dollars string
  const [salonDuration, setSalonDuration] = useState<string>('') // minutes

  // MOBILE fields
  const [mobilePrice, setMobilePrice] = useState<string>('') // dollars string
  const [mobileDuration, setMobileDuration] = useState<string>('') // minutes

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
    if (selectedCategory) {
      return [...selectedCategory.services, ...selectedCategory.children.flatMap((child) => child.services)]
    }
    return []
  }, [selectedCategory, selectedSubcategory])

  const selectedService = useMemo(
    () => servicesForSelection.find((s) => s.id === selectedServiceId) || null,
    [servicesForSelection, selectedServiceId],
  )

  function resetAll() {
    setTitle('')
    setDescription('')
    setCustomImageUrl('')

    setOffersInSalon(true)
    setOffersMobile(false)

    setSalonPrice('')
    setSalonDuration('')
    setMobilePrice('')
    setMobileDuration('')

    setSuccess(null)
    setError(null)
  }

  function resetFormForService(service: ServiceDTO | null) {
    if (!service) {
      resetAll()
      return
    }

    setTitle(service.name)
    setDescription('')
    setCustomImageUrl('')

    setOffersInSalon(true)
    setOffersMobile(false)

    const p = normalizeMoney2(service.minPrice) ?? service.minPrice
    const d = String(service.defaultDurationMinutes)

    setSalonPrice(p)
    setSalonDuration(d)
    setMobilePrice(p)
    setMobileDuration(d)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setSuccess(null)

    if (!selectedService) {
      setError('Please choose a service from the library first.')
      return
    }

    if (!offersInSalon && !offersMobile) {
      setError('Enable at least Salon or Mobile.')
      return
    }

    // SALON validate if enabled
    let salonPriceNorm: string | null = null
    let salonDurationInt: number | null = null
    if (offersInSalon) {
      salonPriceNorm = normalizeMoney2(salonPrice)
      if (!salonPriceNorm) {
        setError('Salon price must be a valid amount like 50 or 49.99')
        return
      }

      salonDurationInt = parseInt(salonDuration, 10)
      if (Number.isNaN(salonDurationInt) || salonDurationInt <= 0) {
        setError('Salon duration must be a positive number of minutes.')
        return
      }

      const minErr = validatePriceMin(salonPriceNorm, selectedService.minPrice, 'Salon')
      if (minErr) {
        setError(minErr)
        return
      }
    }

    // MOBILE validate if enabled
    let mobilePriceNorm: string | null = null
    let mobileDurationInt: number | null = null
    if (offersMobile) {
      mobilePriceNorm = normalizeMoney2(mobilePrice)
      if (!mobilePriceNorm) {
        setError('Mobile price must be a valid amount like 50 or 49.99')
        return
      }

      mobileDurationInt = parseInt(mobileDuration, 10)
      if (Number.isNaN(mobileDurationInt) || mobileDurationInt <= 0) {
        setError('Mobile duration must be a positive number of minutes.')
        return
      }

      const minErr = validatePriceMin(mobilePriceNorm, selectedService.minPrice, 'Mobile')
      if (minErr) {
        setError(minErr)
        return
      }
    }

    setLoading(true)
    try {
      const res = await fetch('/api/pro/offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedService.id,

          title: title.trim() || null,
          description: description.trim() || null,
          customImageUrl: customImageUrl.trim() || null,

          offersInSalon,
          offersMobile,

          salonPriceStartingAt: offersInSalon ? salonPriceNorm : null,
          salonDurationMinutes: offersInSalon ? salonDurationInt : null,

          mobilePriceStartingAt: offersMobile ? mobilePriceNorm : null,
          mobileDurationMinutes: offersMobile ? mobileDurationInt : null,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError((data && (data.error as string)) || 'Something went wrong while saving this service.')
        return
      }

      setSuccess('Service added to your menu.')
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error while saving service.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid #eee',
        padding: 16,
        background: '#fff',
        display: 'grid',
        gap: 16,
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        {/* CATEGORY */}
        <div>
          <label htmlFor="category" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Main category
          </label>
          <select
            id="category"
            value={selectedCategoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
            style={{
              width: '100%',
              borderRadius: 8,
              border: '1px solid #ddd',
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* SUBCATEGORY */}
        <div>
          <label htmlFor="subcategory" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Subcategory (optional)
          </label>
          <select
            id="subcategory"
            value={selectedSubcategoryId}
            onChange={(e) => handleSubcategoryChange(e.target.value)}
            disabled={!selectedCategory}
            style={{
              width: '100%',
              borderRadius: 8,
              border: '1px solid #ddd',
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
              background: !selectedCategory ? '#f7f7f7' : '#fff',
            }}
          >
            <option value="">All under this category</option>
            {selectedCategory?.children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </select>
        </div>

        {/* SERVICE */}
        <div>
          <label htmlFor="service" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Service
          </label>
          <select
            id="service"
            value={selectedServiceId}
            onChange={(e) => handleServiceChange(e.target.value)}
            disabled={!selectedCategory}
            style={{
              width: '100%',
              borderRadius: 8,
              border: '1px solid #ddd',
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
              background: !selectedCategory ? '#f7f7f7' : '#fff',
            }}
          >
            <option value="">Select service</option>
            {servicesForSelection.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* CUSTOMIZATION FORM */}
      <form
        onSubmit={handleSubmit}
        style={{
          borderTop: '1px solid #f0f0f0',
          paddingTop: 12,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="title" style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
              How it shows on your menu
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedService ? selectedService.name : 'Choose a service first'}
              disabled={!selectedService}
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #ddd',
                padding: 8,
                fontSize: 13,
                fontFamily: 'inherit',
                background: !selectedService ? '#f7f7f7' : '#fff',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="desc" style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
              Description (optional)
            </label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!selectedService || loading}
              rows={3}
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #ddd',
                padding: 8,
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
                background: !selectedService ? '#f7f7f7' : '#fff',
              }}
            />
          </div>

          <div>
            <label htmlFor="imageUrl" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
              Custom image URL (optional)
            </label>
            <input
              id="imageUrl"
              type="text"
              value={customImageUrl}
              onChange={(e) => setCustomImageUrl(e.target.value)}
              placeholder="Paste a hosted image URL for now"
              disabled={loading}
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #ddd',
                padding: 8,
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            />
            <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
              Later this becomes “upload a photo” from gallery / camera.
            </div>
          </div>
        </div>

        {/* LOCATION TOGGLES */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={offersInSalon}
              onChange={(e) => setOffersInSalon(e.target.checked)}
              disabled={!selectedService || loading}
            />
            Offer in Salon
          </label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={offersMobile}
              onChange={(e) => setOffersMobile(e.target.checked)}
              disabled={!selectedService || loading}
            />
            Offer Mobile
          </label>

          {selectedService ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Service min price: <b>${normalizeMoney2(selectedService.minPrice) ?? selectedService.minPrice}</b>
            </div>
          ) : null}
        </div>

        {/* SALON */}
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 12,
            padding: 12,
            background: offersInSalon ? '#fff' : '#fafafa',
            opacity: offersInSalon ? 1 : 0.6,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Salon pricing</div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Starting at</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13 }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={salonPrice}
                  onChange={(e) => setSalonPrice(e.target.value)}
                  disabled={!selectedService || loading || !offersInSalon}
                  style={{
                    flex: 1,
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    padding: 8,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    background: !offersInSalon ? '#f3f4f6' : '#fff',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Duration (minutes)</label>
              <input
                type="number"
                min={1}
                value={salonDuration}
                onChange={(e) => setSalonDuration(e.target.value)}
                disabled={!selectedService || loading || !offersInSalon}
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: !offersInSalon ? '#f3f4f6' : '#fff',
                }}
              />
            </div>
          </div>
        </div>

        {/* MOBILE */}
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 12,
            padding: 12,
            background: offersMobile ? '#fff' : '#fafafa',
            opacity: offersMobile ? 1 : 0.6,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Mobile pricing</div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Starting at</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13 }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={mobilePrice}
                  onChange={(e) => setMobilePrice(e.target.value)}
                  disabled={!selectedService || loading || !offersMobile}
                  style={{
                    flex: 1,
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    padding: 8,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    background: !offersMobile ? '#f3f4f6' : '#fff',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Duration (minutes)</label>
              <input
                type="number"
                min={1}
                value={mobileDuration}
                onChange={(e) => setMobileDuration(e.target.value)}
                disabled={!selectedService || loading || !offersMobile}
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: !offersMobile ? '#f3f4f6' : '#fff',
                }}
              />
            </div>
          </div>
        </div>

        {error ? <div style={{ fontSize: 12, color: 'red' }}>{error}</div> : null}
        {success ? <div style={{ fontSize: 12, color: 'green' }}>{success}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setSelectedServiceId('')
              resetFormForService(null)
            }}
            disabled={loading}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid #ccc',
              fontSize: 13,
              background: '#f7f7f7',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            Reset
          </button>

          <button
            type="submit"
            disabled={loading || !selectedService}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              border: 'none',
              fontSize: 13,
              background: selectedService ? '#111' : '#999',
              color: '#fff',
              cursor: selectedService && !loading ? 'pointer' : 'default',
            }}
          >
            {loading ? 'Adding…' : 'Add to my menu'}
          </button>
        </div>
      </form>
    </div>
  )
}
