// app/(main)/looks/_components/LooksTopBar.tsx
'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

const TAB_LOOKS = 'Look'
const TAB_SPOTLIGHT = 'Spotlight'

const TEXT_SHADOW = '0 2px 20px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.9)'
const PAPER = 'rgba(244,239,231,1)'
const PAPER_DIM = 'rgba(244,239,231,0.65)'

export default function LooksTopBar(props: {
  categories: string[]
  activeCategory: string
  onSelectCategory: (c: string) => void
  query: string
  setQuery: (v: string) => void
}) {
  const { categories, activeCategory, onSelectCategory, query, setQuery } = props
  const [searchOpen, setSearchOpen] = useState(false)

  const tabs = useMemo(() => {
    const cleaned = (categories || [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean)
      .filter((c) => c.toLowerCase() !== 'for you')

    const seen = new Set<string>()
    const unique: string[] = []
    for (const c of cleaned) {
      const key = c.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(c)
    }

    const rest = unique.filter((c) => {
      const key = c.toLowerCase()
      return key !== TAB_LOOKS.toLowerCase() && key !== TAB_SPOTLIGHT.toLowerCase()
    })

    return [TAB_SPOTLIGHT, ...rest]
  }, [categories])

  const looksActive = activeCategory === TAB_LOOKS

  return (
    <div
      className="fixed left-0 right-0 top-0 z-50"
      style={{
        paddingTop: `calc(env(safe-area-inset-top, 0px) + 10px)`,
        pointerEvents: 'none',
      }}
    >
      <div className="mx-auto w-full max-w-140 px-4" style={{ pointerEvents: 'auto' }}>
        {/* Main row */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14 }}>
          {/* Left: "Looks" title (= the all tab) + scrollable secondary tabs */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, overflow: 'hidden', flex: 1 }}>
            {/* "Looks" serif word IS the all-feed tab */}
            <button
              type="button"
              onClick={() => onSelectCategory(TAB_LOOKS)}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-display-face, "Fraunces"), Georgia, serif',
                fontStyle: 'italic',
                fontWeight: 600,
                fontSize: 20,
                color: looksActive ? PAPER : PAPER_DIM,
                textShadow: TEXT_SHADOW,
                flexShrink: 0,
                lineHeight: 1.2,
                position: 'relative',
              }}
            >
              Looks
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -6,
                  height: 2,
                  borderRadius: 999,
                  background: PAPER,
                  boxShadow: '0 0 10px rgba(244,239,231,0.4)',
                  opacity: looksActive ? 1 : 0,
                  transition: 'opacity 160ms ease',
                }}
              />
            </button>

            {/* Scrollable tab strip — Spotlight + admin categories */}
            <div
              className="looksNoScrollbar"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 16,
                overflowX: 'auto',
                overflowY: 'hidden',
                whiteSpace: 'nowrap',
                paddingBottom: 8,
              }}
            >
              {tabs.map((c) => {
                const active = c === activeCategory
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onSelectCategory(c)}
                    style={{
                      appearance: 'none',
                      background: 'transparent',
                      border: 'none',
                      padding: '0 1px',
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: active ? PAPER : PAPER_DIM,
                      textShadow: TEXT_SHADOW,
                      position: 'relative',
                      flexShrink: 0,
                      lineHeight: 1.2,
                    }}
                  >
                    {c}
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: -6,
                        height: 2,
                        borderRadius: 999,
                        background: PAPER,
                        boxShadow: '0 0 10px rgba(244,239,231,0.4)',
                        opacity: active ? 1 : 0,
                        transition: 'opacity 160ms ease',
                      }}
                    />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right: search button */}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            style={{
              width: 32,
              height: 32,
              display: 'grid',
              placeItems: 'center',
              color: PAPER,
              textShadow: TEXT_SHADOW,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {searchOpen ? <X size={18} /> : <Search size={20} />}
          </button>
        </div>

        {/* Search field */}
        {searchOpen && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 14,
              background: 'rgba(10,9,7,0.80)',
              border: '1px solid rgba(244,239,231,0.14)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Search size={16} style={{ color: PAPER_DIM, flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pros or services"
              autoFocus
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: PAPER,
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{
                  width: 26,
                  height: 26,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 999,
                  background: 'rgba(244,239,231,0.10)',
                  border: '1px solid rgba(244,239,231,0.12)',
                  cursor: 'pointer',
                  color: PAPER,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
