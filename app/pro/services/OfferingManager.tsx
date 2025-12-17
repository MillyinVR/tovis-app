// app/pro/services/OfferingManager.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Offering = {
  id: string
  serviceId: string
  title: string | null
  description: string | null
  price: string
  durationMinutes: number
  customImageUrl: string | null
  defaultImageUrl?: string | null
  serviceName: string
  categoryName: string | null
}

type Props = {
  initialOfferings: Offering[]
}

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

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function pickImage(o: Offering) {
  const src = (o.customImageUrl || o.defaultImageUrl || '').trim()
  return src || null
}

export default function OfferingManager({ initialOfferings }: Props) {
  const router = useRouter()
  const offerings = useMemo(() => initialOfferings ?? [], [initialOfferings])

  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorById, setErrorById] = useState<Record<string, string | null>>({})
  const [successById, setSuccessById] = useState<Record<string, string | null>>({})

  function clearMessages(id: string) {
    setErrorById((m) => ({ ...m, [id]: null }))
    setSuccessById((m) => ({ ...m, [id]: null }))
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {offerings.map((o) => (
        <OfferingCard
          key={o.id}
          offering={o}
          isOpen={openId === o.id}
          busy={busyId === o.id}
          error={errorById[o.id] ?? null}
          success={successById[o.id] ?? null}
          onToggle={() => {
            clearMessages(o.id)
            setOpenId((cur) => (cur === o.id ? null : o.id))
          }}
          onSave={async (patch) => {
            setBusyId(o.id)
            clearMessages(o.id)
            try {
              const res = await fetch(`/api/pro/offerings/${o.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
              })
              const data = await safeJson(res)
              if (!res.ok) {
                setErrorById((m) => ({ ...m, [o.id]: data?.error || `Save failed (${res.status})` }))
                return
              }
              setSuccessById((m) => ({ ...m, [o.id]: 'Saved.' }))
              router.refresh()
              setOpenId(null)
            } catch {
              setErrorById((m) => ({ ...m, [o.id]: 'Network error while saving.' }))
            } finally {
              setBusyId(null)
            }
          }}
          onRemove={async () => {
            setBusyId(o.id)
            clearMessages(o.id)
            try {
              const res = await fetch(`/api/pro/offerings/${o.id}`, { method: 'DELETE' })
              const data = await safeJson(res)
              if (!res.ok) {
                setErrorById((m) => ({ ...m, [o.id]: data?.error || `Remove failed (${res.status})` }))
                return
              }
              router.refresh()
              if (openId === o.id) setOpenId(null)
            } catch {
              setErrorById((m) => ({ ...m, [o.id]: 'Network error while removing.' }))
            } finally {
              setBusyId(null)
            }
          }}
        />
      ))}
    </div>
  )
}

function OfferingCard({
  offering: o,
  isOpen,
  busy,
  error,
  success,
  onToggle,
  onSave,
  onRemove,
}: {
  offering: Offering
  isOpen: boolean
  busy: boolean
  error: string | null
  success: string | null
  onToggle: () => void
  onSave: (patch: { title?: string | null; description?: string | null; price?: string; durationMinutes?: number; customImageUrl?: string | null }) => void
  onRemove: () => void
}) {
  // Local editable state
  const [title, setTitle] = useState(o.title ?? o.serviceName)
  const [description, setDescription] = useState(o.description ?? '')
  const [price, setPrice] = useState(o.price)
  const [duration, setDuration] = useState(String(o.durationMinutes))
  const [customImageUrl, setCustomImageUrl] = useState(o.customImageUrl ?? '')

  const imgSrc = pickImage(o)

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid #eee',
        padding: 12,
        background: '#fff',
        display: 'grid',
        gap: 10,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              border: '1px solid #eee',
              overflow: 'hidden',
              background: '#f7f7f7',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#9ca3af',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              'NO IMAGE'
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.title || o.serviceName}
            </div>

            {o.categoryName ? <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{o.categoryName}</div> : null}

            <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
              {o.durationMinutes} min • ${o.price}
            </div>

            {o.customImageUrl ? (
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Custom image override</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #ddd',
              background: '#fafafa',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 12,
            }}
          >
            {isOpen ? 'Close' : 'Edit'}
          </button>

          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #fca5a5',
              background: '#fff',
              color: '#b91c1c',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 12,
            }}
          >
            {busy ? 'Working…' : 'Remove'}
          </button>
        </div>
      </div>

      {isOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()

            const priceNorm = normalizeMoney2(price)
            if (!priceNorm) return alert('Price must be like 50 or 49.99')

            const d = Math.trunc(Number(duration))
            if (!Number.isFinite(d) || d <= 0) return alert('Duration must be a positive number.')

            onSave({
              title: title.trim() || null,
              description: description.trim() || null,
              price: priceNorm,
              durationMinutes: d,
              customImageUrl: customImageUrl.trim() || null,
            })
          }}
          style={{
            borderTop: '1px solid #f0f0f0',
            paddingTop: 10,
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '2fr 1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                style={{ borderRadius: 8, border: '1px solid #ddd', padding: 8, fontSize: 13 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Price</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={busy}
                inputMode="decimal"
                style={{ borderRadius: 8, border: '1px solid #ddd', padding: 8, fontSize: 13 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Minutes</span>
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={busy}
                type="number"
                min={1}
                style={{ borderRadius: 8, border: '1px solid #ddd', padding: 8, fontSize: 13 }}
              />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={3}
              style={{ borderRadius: 8, border: '1px solid #ddd', padding: 8, fontSize: 13, resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Custom image URL (optional)</span>
            <input
              value={customImageUrl}
              onChange={(e) => setCustomImageUrl(e.target.value)}
              disabled={busy}
              placeholder="https://..."
              style={{ borderRadius: 8, border: '1px solid #ddd', padding: 8, fontSize: 13 }}
            />
            <span style={{ fontSize: 11, color: '#777' }}>
              This overrides the default service image (if one exists).
            </span>
          </label>

          {error ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div> : null}
          {success ? <div style={{ fontSize: 12, color: '#16a34a' }}>{success}</div> : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                border: 'none',
                background: '#111',
                color: '#fff',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 12,
              }}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
