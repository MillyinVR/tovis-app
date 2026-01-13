'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

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
    // Dynamic/admin-friendly:
    // - remove empty strings
    // - remove "For You"
    // - ensure "The Looks" exists and is first
    const cleaned = (categories || [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean)
      .filter((c) => c.toLowerCase() !== 'for you')

    const unique = Array.from(new Set(cleaned))
    if (!unique.includes('The Looks')) unique.unshift('The Looks')
    return unique
  }, [categories])

  return (
    <div
      className="fixed left-0 right-0 top-0 z-50"
      style={{
        paddingTop: `calc(env(safe-area-inset-top, 0px) + 10px)`,
        pointerEvents: 'none',
      }}
    >
      <div className="mx-auto w-full max-w-140 px-3" style={{ pointerEvents: 'auto' }}>
        {/* Row: scrollable tabs + pinned search */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {/* Scrollable tabs shell */}
          <div
            className="looksNoScrollbar"
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 14,
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
            }}
          >
            {/* Actual scrolling area */}
            <div
              className="looksNoScrollbar"
              style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                columnGap: 16,
                padding: '8px 10px',
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
                      padding: '0 2px',
                      margin: 0,
                      cursor: 'pointer',
                      color: active ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.62)',
                      fontSize: 13,
                      fontWeight: active ? 800 : 600,
                      letterSpacing: 0.2,
                      position: 'relative',
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
                        bottom: -7,
                        height: 2,
                        borderRadius: 999,
                        opacity: active ? 1 : 0,
                        background: 'rgba(255,255,255,0.95)',
                        boxShadow: '0 0 14px rgba(255,255,255,0.35)',
                        transition: 'opacity 160ms ease',
                      }}
                    />
                  </button>
                )
              })}
            </div>

            {/* Right-edge fade so scroll feels premium */}
            <div
              aria-hidden
              style={{
                pointerEvents: 'none',
                position: 'absolute',
                top: 0,
                right: 0,
                width: 22,
                height: '100%',
                background: 'linear-gradient(to left, rgba(0,0,0,0.32), rgba(0,0,0,0))',
              }}
            />
          </div>

          {/* Pinned Search button */}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            title={searchOpen ? 'Close search' : 'Search'}
            style={{
              width: 38,
              height: 38,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.95)',
            }}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
        </div>

        {/* Search field (below) */}
        {searchOpen ? (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 16,
              background: 'rgba(0,0,0,0.32)',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Search size={16} style={{ color: 'rgba(255,255,255,0.72)' }} />
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
                color: 'white',
                fontSize: 13,
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{
                  width: 28,
                  height: 28,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.10)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  cursor: 'pointer',
                  color: 'white',
                }}
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
