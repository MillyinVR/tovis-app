// lib/brand/BrandProvider.tsx
'use client'

import React, { createContext, useContext, useMemo, useState } from 'react'
import type { BrandConfig, BrandMode } from './types'
import { getBrandConfig, getInitialMode } from './index'
import { toCssVars } from './utils'

type BrandContextValue = {
  brand: BrandConfig
  mode: BrandMode
  setMode: (m: BrandMode) => void
}

const BrandContext = createContext<BrandContextValue | null>(null)

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const brand = useMemo(() => getBrandConfig(), [])
  const [mode, setMode] = useState<BrandMode>(() => getInitialMode(brand))

  const tokens = brand.tokensByMode[mode]
  const cssVars = toCssVars(tokens)

  return (
    <BrandContext.Provider value={{ brand, mode, setMode }}>
      {/* We set CSS variables at the app root. */}
      <div style={cssVars as React.CSSProperties} data-brand={brand.id} data-mode={mode}>
        {children}
      </div>
    </BrandContext.Provider>
  )
}

export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error('useBrand must be used within BrandProvider')
  return ctx
}
