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
  title: string | null
  price: string // dollars string
  durationMinutes: number
  customImageUrl: string | null
  serviceName: string
  categoryName: string | null
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

// Safe compare: turn "12.34" into integer cents in the UI only
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

  // UI-only for now (API route doesn’t support these yet)
  const [title, setTitle] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  // These DO submit
  const [price, setPrice] = useState<string>('') // dollars string
  const [duration, setDuration] = useState<string>('') // minutes

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
      return [
        ...selectedCategory.services,
        ...selectedCategory.children.flatMap((child) => child.services),
      ]
    }
    return []
  }, [selectedCategory, selectedSubcategory])

  const selectedService = useMemo(
    () => servicesForSelection.find((s) => s.id === selectedServiceId) || null,
    [servicesForSelection, selectedServiceId],
  )

  function resetFormForService(service: ServiceDTO | null) {
    if (!service) {
      setTitle('')
      setPrice('')
      setDuration('')
      return
    }
    setTitle(service.name)
    setPrice(normalizeMoney2(service.minPrice) ?? service.minPrice)
    setDuration(String(service.defaultDurationMinutes))
  }

  function handleCategoryChange(id: string) {
    setSelectedCategoryId(id)
    setSelectedSubcategoryId('')
    setSelectedServiceId('')
    resetFormForService(null)
    setSuccess(null)
    setError(null)
  }

  function handleSubcategoryChange(id: string) {
    setSelectedSubcategoryId(id)
    setSelectedServiceId('')
    resetFormForService(null)
    setSuccess(null)
    setError(null)
  }

  function handleServiceChange(id: string) {
    setSelectedServiceId(id)
    const svc = servicesForSelection.find((s) => s.id === id) || null
    resetFormForService(svc)
    setSuccess(null)
    setError(null)
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

    const priceNorm = normalizeMoney2(price)
    if (!priceNorm) {
      setError('Price must be a valid amount like 50 or 49.99')
      return
    }

    const durationInt = parseInt(duration, 10)
    if (Number.isNaN(durationInt) || durationInt <= 0) {
      setError('Duration must be a positive number of minutes.')
      return
    }

    // min price check (client-side only)
    const enteredCents = moneyToCentsInt(priceNorm)
    const minCents = moneyToCentsInt(selectedService.minPrice)
    if (enteredCents === null || minCents === null) {
      setError('Invalid price configuration. Check the service min price.')
      return
    }
    if (enteredCents < minCents) {
      setError(`Price must be at least $${normalizeMoney2(selectedService.minPrice) ?? selectedService.minPrice}.`)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/pro/offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedService.id,
          price: priceNorm, // ✅ dollars string for API boundary
          durationMinutes: durationInt,
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
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
          }}
        >
          <div>
            <label htmlFor="title" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
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

          <div>
            <label htmlFor="price" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
              Base price (you)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13 }}>$</span>
              <input
                id="price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={!selectedService || loading}
                style={{
                  flex: 1,
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: !selectedService ? '#f7f7f7' : '#fff',
                }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="duration" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
              Duration (minutes)
            </label>
            <input
              id="duration"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              disabled={!selectedService || loading}
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
        </div>

        <div>
          <label htmlFor="imageUrl" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Custom image URL (optional)
          </label>
          <input
            id="imageUrl"
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
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

        {error ? <div style={{ fontSize: 12, color: 'red' }}>{error}</div> : null}
        {success ? <div style={{ fontSize: 12, color: 'green' }}>{success}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setSelectedServiceId('')
              resetFormForService(null)
              setImageUrl('')
              setError(null)
              setSuccess(null)
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
