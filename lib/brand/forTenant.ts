// lib/brand/forTenant.ts
//
// Bridge between the tenant system (lib/tenant) and brand resolution
// (lib/brand). Tenant-facing surfaces resolve their brand through this
// function so branding follows the asymmetric tenant rule:
//
// - tovis-root context renders the TOVIS brand
// - a white-label context resolves the brand registered under its tenant
//   slug, falling back to the TOVIS brand until a per-tenant BrandConfig
//   exists (add one in lib/brand/brands/<slug>.ts and register it)
//
// Emails, SMS, and notification copy migrate onto this path as the
// check-no-hardcoded-brand-strings baseline burns down (WS-6).
//
// This deliberately does NOT go through resolveBrandId: that chain falls
// back to host mapping and NEXT_PUBLIC_BRAND, which must never decide a
// white-label tenant's branding. An unregistered tenant slug falls back to
// the TOVIS brand explicitly.

import { tovisBrand } from './brands/tovis'
import { getRegisteredBrandConfig } from './index'
import type { BrandConfig } from './types'
import type { TenantContext } from '@/lib/tenant/context'

export function getBrandForTenantContext(ctx: TenantContext): BrandConfig {
  if (ctx.isRoot) return tovisBrand

  return getRegisteredBrandConfig(ctx.slug) ?? tovisBrand
}
