'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  initial: {
    businessName: string | null
    bio: string | null
    location: string | null
    avatarUrl: string | null
    professionType: string | null
  }
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

  async function save() {
    try {
      setSaving(true)
      setError(null)

      const res = await fetch('/api/pro/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          professionType,
          location,
          bio,
          avatarUrl,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to save')

      setOpen(false)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          padding: '8px 12px',
          borderRadius: 999,
          border: '1px solid #111',
          background: '#fff',
          color: '#111',
          cursor: 'pointer',
          fontWeight: 700,
        }}
      >
        Edit
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 999,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
          onClick={() => !saving && setOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              borderRadius: 16,
              background: '#fff',
              border: '1px solid #eee',
              padding: 14,
              fontFamily: 'system-ui',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Edit profile</div>
              <button
                type="button"
                onClick={() => !saving && setOpen(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 16,
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <Field label="Business name">
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. Lumara Beauty"
                />
              </Field>

              <Field label="Profession type">
                <input
                  value={professionType}
                  onChange={(e) => setProfessionType(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. MAKEUP_ARTIST"
                />
              </Field>

              <Field label="Location">
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. New York, NY"
                />
              </Field>

              <Field label="Avatar URL (for now)">
                <input
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  style={inputStyle}
                  placeholder="https://..."
                />
              </Field>

              <Field label="Bio">
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
                  placeholder="Short, confident, clear."
                />
              </Field>

              {error ? (
                <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>
              ) : null}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => !saving && setOpen(false)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid #111',
                    background: '#111',
                    color: '#fff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 800,
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
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
    <label style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, color: '#374151', fontWeight: 700 }}>{label}</div>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  fontSize: 13,
  fontFamily: 'system-ui',
}
