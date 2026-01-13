// lib/brand/index.ts
import type { BrandConfig, BrandId, BrandMode } from './types'
import { tovisBrand } from './brands/tovis'

// Seam for white-label later:
// - host-based resolution
// - env var (NEXT_PUBLIC_BRAND)
// - or tenant config
export function resolveBrandId(): BrandId {
  // For now: always TOVIS.
  // Later example:
  // const fromEnv = process.env.NEXT_PUBLIC_BRAND?.trim()
  // if (fromEnv) return fromEnv as BrandId
  return 'tovis'
}

export function getBrandConfig(): BrandConfig {
  const id = resolveBrandId()
  if (id === 'tovis') return tovisBrand
  // default fallback
  return tovisBrand
}

export function getInitialMode(brand: BrandConfig): BrandMode {
  return brand.defaultMode
}
