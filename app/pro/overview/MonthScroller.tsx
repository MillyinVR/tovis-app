// app/pro/overview/MonthScroller.tsx
'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function fmtMonth(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

type Item = { month: string; label: string }

export default function MonthScroller({ monthsBack = 12 }: { monthsBack?: number }) {
  const router = useRouter()
  const sp = useSearchParams()

  // ✅ unify with dashboard: ?month=YYYY-MM
  const active = sp.get('month') || fmtMonth(new Date())

  const items = useMemo<Item[]>(() => {
    const now = new Date()
    const out: Item[] = []

    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({
        month: fmtMonth(d),
        label: `${d.toLocaleString(undefined, { month: 'short' })} ${d.getFullYear()}`,
      })
    }

    return out
  }, [monthsBack])

  return (
    <div className="looksNoScrollbar flex gap-2 overflow-x-auto pb-1">
      {items.map((it) => {
        const isActive = it.month === active

        return (
          <button
            key={it.month}
            type="button"
            onClick={() => router.push(`/pro/dashboard?month=${encodeURIComponent(it.month)}`)}
            className={[
              'shrink-0 rounded-full px-3 py-2 text-[12px] font-black transition',
              'border',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
              isActive
                ? 'border-white/20 bg-bgSecondary text-textPrimary shadow-[0_8px_30px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.10)]'
                : 'border-white/10 bg-bgPrimary text-textSecondary hover:border-white/20 hover:bg-bgSecondary/60 hover:text-textPrimary',
            ].join(' ')}
            aria-current={isActive ? 'date' : undefined}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
