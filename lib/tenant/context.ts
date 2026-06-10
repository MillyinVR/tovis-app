// lib/tenant/context.ts

import { TOVIS_ROOT_TENANT_SLUG } from './constants'

/**
 * Resolved tenant identity for a request. `isRoot` is the asymmetric
 * visibility switch: root context sees across all tenants; a white-label
 * context is confined to its own tenant.
 */
export type TenantContext =
  | { isRoot: true; tenantId: string; slug: typeof TOVIS_ROOT_TENANT_SLUG }
  | { isRoot: false; tenantId: string; slug: string }

export function rootTenantContext(tenantId: string): TenantContext {
  return { isRoot: true, tenantId, slug: TOVIS_ROOT_TENANT_SLUG }
}

export function whiteLabelTenantContext(args: {
  tenantId: string
  slug: string
}): TenantContext {
  return { isRoot: false, tenantId: args.tenantId, slug: args.slug }
}
