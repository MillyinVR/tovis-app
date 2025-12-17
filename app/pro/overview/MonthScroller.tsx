'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function fmtYM(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export default function MonthScroller({ monthsBack = 12 }: { monthsBack?: number }) {
  const router = useRouter()
  const sp = useSearchParams()
  const active = sp.get('ym') || fmtYM(new Date())

  const items = useMemo(() => {
    const now = new Date()
    const out: { ym: string; label: string }[] = []
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({
        ym: fmtYM(d),
        label: d.toLocaleString(undefined, { month: 'short' }) + ` ${d.getFullYear()}`,
      })
    }
    return out
  }, [monthsBack])

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
      {items.map((it) => {
        const isActive = it.ym === active
        return (
          <button
            key={it.ym}
            type="button"
            onClick={() => router.push(`/pro?ym=${it.ym}`)}
            style={{
              flex: '0 0 auto',
              borderRadius: 999,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 800,
              border: isActive ? '1px solid #111' : '1px solid #e5e7eb',
              background: isActive ? '#111' : '#fff',
              color: isActive ? '#fff' : '#111',
              cursor: 'pointer',
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
