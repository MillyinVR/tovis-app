'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

type Props = {
  serviceId: string
  professionalId: string
}

function safeJson(res: Response) {
  return res.json().catch(() => ({}))
}

export default function WaitlistJoinButton({ serviceId, professionalId }: Props) {
  const router = useRouter()
  const sp = useSearchParams()

  const mediaId = useMemo(() => (sp?.get('mediaId') || '').trim() || null, [sp])

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function join() {
    if (loading) return
    setLoading(true)
    setErr(null)
    setOk(false)

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          professionalId,
          mediaId,
          // keep it simple for now:
          preferredTimeBucket: 'ANY',
          notes: null,
          preferredStart: null,
          preferredEnd: null,
        }),
      })

      const data: any = await safeJson(res)

      if (!res.ok) {
        setErr(data?.error || `Request failed (${res.status})`)
        return
      }

      setOk(true)
      router.refresh()
      // take them to the waitlist tab so they see it instantly
      router.push('/client')
    } catch (e) {
      console.error(e)
      setErr('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button
        type="button"
        onClick={join}
        disabled={loading}
        style={{
          border: '1px solid #ddd',
          background: '#fff',
          color: '#111',
          padding: '10px 12px',
          borderRadius: 12,
          fontWeight: 900,
          fontSize: 13,
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Joining…' : ok ? 'Added to waitlist' : 'Join waitlist'}
      </button>

      {err ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{err}</div> : null}
      {!err ? <div style={{ fontSize: 12, color: '#6b7280' }}>If a spot opens up, you’ll be first in line.</div> : null}
    </div>
  )
}
