// lib/brand/index.ts
import type { BrandConfig, BrandId, BrandMode } from './types'
import { tovisBrand } from './brands/tovis'

type BrandResolutionInput = {
  tenantBrandId?: string | null
  host?: string | null
}

const DEFAULT_BRAND_ID: BrandId = 'tovis'

const brandRegistry: Record<BrandId, BrandConfig> = {
  tovis: tovisBrand,
}

function normalizeBrandId(value: string | null | undefined): BrandId | null {
  const trimmed = value?.trim().toLowerCase()

  return trimmed ? trimmed : null
}

function brandIdFromHost(host: string | null | undefined): BrandId | null {
  const normalizedHost = host?.trim().toLowerCase()

  if (!normalizedHost) return null

  // White-label seam:
  // Later, map hostnames/subdomains to brand IDs here or replace this with
  // tenant config from the database.
  //
  // Examples:
  // - tovis.app              -> tovis
  // - salon-name.tovis.app   -> salon-name
  // - customsalon.com        -> salon-name
  if (
    normalizedHost === 'tovis.app' ||
    normalizedHost === 'www.tovis.app' ||
    normalizedHost === 'localhost' ||
    normalizedHost.startsWith('localhost:')
  ) {
    return 'tovis'
  }

  return null
}

function brandExists(id: BrandId): boolean {
  return brandRegistry[id] !== undefined
}

// Seam for white-label:
// Resolution priority:
// 1. tenant config / database value
// 2. host mapping
// 3. env default
// 4. hard fallback to TOVIS
export function resolveBrandId(input: BrandResolutionInput = {}): BrandId {
  const fromTenant = normalizeBrandId(input.tenantBrandId)

  if (fromTenant && brandExists(fromTenant)) {
    return fromTenant
  }

  const fromHost = brandIdFromHost(input.host)

  if (fromHost && brandExists(fromHost)) {
    return fromHost
  }

  const fromEnv = normalizeBrandId(process.env.NEXT_PUBLIC_BRAND)

  if (fromEnv && brandExists(fromEnv)) {
    return fromEnv
  }

  return DEFAULT_BRAND_ID
}

export function getBrandConfig(input: BrandResolutionInput = {}): BrandConfig {
  const id = resolveBrandId(input)

  return brandRegistry[id] ?? tovisBrand
}

export function getInitialMode(brand: BrandConfig): BrandMode {
  return brand.defaultMode
}