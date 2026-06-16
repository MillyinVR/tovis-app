// lib/brand/BrandProvider.tsx
'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type { BrandConfig, BrandMode } from './types'
import { getBrandConfig } from './index'
import { toCssVars } from './utils'
import {
  applyMode,
  getModeSnapshot,
  getPreferenceSnapshot,
  getServerModeSnapshot,
  getServerPreferenceSnapshot,
  setStoredPreference,
  subscribeTheme,
  type ThemePreference,
} from './theme'

type BrandContextValue = {
  brand: BrandConfig
  /** Resolved color mode currently applied. */
  mode: BrandMode
  /** User preference: 'system' follows the device. */
  preference: ThemePreference
  /** Set + persist the preference (System / Light / Dark). */
  setPreference: (p: ThemePreference) => void
  /** Back-compat low-level setter — persists as an explicit mode. */
  setMode: (m: BrandMode) => void
}

const BrandContext = createContext<BrandContextValue | null>(null)

type BrandProviderProps = {
  children: React.ReactNode
  /**
   * Tenant-resolved brand from the server (root layout via
   * getBrandForTenantContext). When omitted — detached client trees and
   * tests — falls back to the env/host default chain, which is only safe
   * for root-brand surfaces.
   */
  brand?: BrandConfig
}

function serializeVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
}

export function BrandProvider({ children, brand: brandProp }: BrandProviderProps) {
  const brand = useMemo(() => brandProp ?? getBrandConfig(), [brandProp])

  // Subscribe to the persisted preference + device prefers-color-scheme.
  const preference = useSyncExternalStore(
    subscribeTheme,
    getPreferenceSnapshot,
    getServerPreferenceSnapshot,
  )
  const mode = useSyncExternalStore(
    subscribeTheme,
    getModeSnapshot,
    getServerModeSnapshot,
  )

  // Keep <html data-mode> / color-scheme in sync with the resolved mode.
  useEffect(() => {
    applyMode(mode)
  }, [mode])

  // Emit BOTH modes as [data-mode]-scoped CSS variables. The pre-paint inline
  // script sets <html data-mode>, so the right variables apply before first
  // paint (no flash), and a nested [data-mode="dark"] can pin a subtree (e.g.
  // the Looks feed) regardless of the global theme. One brand renders per
  // request (server-resolved), so no brand-id scoping is needed here.
  const themeCss = useMemo(() => {
    const dark = serializeVars(toCssVars(brand.tokensByMode.dark))
    const light = serializeVars(toCssVars(brand.tokensByMode.light))
    return `[data-mode="dark"]{${dark}}[data-mode="light"]{${light}}`
  }, [brand])

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next)
  }, [])

  const setMode = useCallback((next: BrandMode) => {
    setStoredPreference(next)
  }, [])

  const value = useMemo<BrandContextValue>(
    () => ({ brand, mode, preference, setPreference, setMode }),
    [brand, mode, preference, setPreference, setMode],
  )

  return (
    <BrandContext.Provider value={value}>
      <style data-brand-theme={brand.id} dangerouslySetInnerHTML={{ __html: themeCss }} />
      <div data-brand={brand.id}>{children}</div>
    </BrandContext.Provider>
  )
}

export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error('useBrand must be used within BrandProvider')
  return ctx
}
