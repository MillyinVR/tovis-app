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

/**
 * Build the context for a tenant row already loaded from the database — the
 * reserved root slug yields a root context, anything else a white-label one.
 *
 * This is the single place that decision is made. Deciding it inline at each
 * call site is how a surface ends up treating a white-label tenant as root
 * (which grants cross-tenant visibility) or the root tenant as white-label
 * (which confines it to itself); both fail silently.
 *
 * Takes an object rather than two positional strings so an id and a slug can
 * never be handed over the wrong way round.
 */
export function tenantContextFor(args: {
  tenantId: string
  slug: string
}): TenantContext {
  return args.slug === TOVIS_ROOT_TENANT_SLUG
    ? rootTenantContext(args.tenantId)
    : whiteLabelTenantContext(args)
}
