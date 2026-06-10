// lib/tenant/resolveTenant.ts
//
// Request → tenant context. Resolution rule:
//
//   1. If the request host exactly matches an active tenant's customDomain,
//      resolve that white-label tenant.
//   2. Otherwise resolve the reserved root tenant (tovis-root).
//
// The root Tenant row must exist (created by seed/backfill). Resolving
// before the backfill has run is a deployment-order bug, so it throws
// loudly instead of inventing a tenant.
//
// The root layout resolves a tenant context on every page render, so both
// lookups here are load-bounded: the root tenant id is memoized for the
// process lifetime (the reserved row is never deleted or re-slugged), and
// host → domain lookups go through a bounded TTL cache. Domain mappings
// change rarely; adding/removing a customDomain may take up to
// TENANT_HOST_CACHE_TTL_MS to be observed, which is acceptable for branding.

import { prisma } from '@/lib/prisma'

import { TOVIS_ROOT_TENANT_NAME, TOVIS_ROOT_TENANT_SLUG } from './constants'
import {
  rootTenantContext,
  whiteLabelTenantContext,
  type TenantContext,
} from './context'

/** Lowercases and strips port/whitespace; null for empty/invalid hosts. */
export function normalizeHost(host: string | null | undefined): string | null {
  if (typeof host !== 'string') return null

  const trimmed = host.trim().toLowerCase()
  if (!trimmed) return null

  const withoutPort = trimmed.split(':')[0] ?? ''
  return withoutPort || null
}

export const TENANT_HOST_CACHE_TTL_MS = 60_000

// Hosts arrive from request headers, so the cache must stay bounded even if
// a client sprays arbitrary Host values. Past the cap the whole map resets —
// crude, but it keeps the worst case at one extra DB lookup per request.
const TENANT_HOST_CACHE_MAX_ENTRIES = 500

type CachedHostLookup = {
  tenant: { id: string; slug: string } | null
  expiresAt: number
}

let cachedRootTenantId: string | null = null
const hostLookupCache = new Map<string, CachedHostLookup>()

/** Test-only: reset process-level tenant resolution caches. */
export function clearTenantResolutionCache(): void {
  cachedRootTenantId = null
  hostLookupCache.clear()
}

export async function getRootTenantId(): Promise<string> {
  if (cachedRootTenantId) return cachedRootTenantId

  const root = await prisma.tenant.findUnique({
    where: { slug: TOVIS_ROOT_TENANT_SLUG },
    select: { id: true },
  })

  if (!root) {
    throw new Error(
      `Reserved root tenant '${TOVIS_ROOT_TENANT_SLUG}' does not exist. ` +
        'Run prisma/scripts/backfillTenantFoundation.ts (or seed) first.',
    )
  }

  cachedRootTenantId = root.id
  return root.id
}

/**
 * Idempotently create the reserved root tenant. Used by seed and backfill —
 * never by request-path code.
 */
export async function ensureRootTenant(): Promise<string> {
  const root = await prisma.tenant.upsert({
    where: { slug: TOVIS_ROOT_TENANT_SLUG },
    update: {},
    create: {
      slug: TOVIS_ROOT_TENANT_SLUG,
      name: TOVIS_ROOT_TENANT_NAME,
      isActive: true,
    },
    select: { id: true },
  })

  return root.id
}

async function lookupTenantByCustomDomain(
  normalizedHost: string,
): Promise<{ id: string; slug: string } | null> {
  const now = Date.now()
  const cached = hostLookupCache.get(normalizedHost)

  if (cached && cached.expiresAt > now) {
    return cached.tenant
  }

  const tenant = await prisma.tenant.findFirst({
    where: { customDomain: normalizedHost, isActive: true },
    select: { id: true, slug: true },
  })

  if (hostLookupCache.size >= TENANT_HOST_CACHE_MAX_ENTRIES) {
    hostLookupCache.clear()
  }

  hostLookupCache.set(normalizedHost, {
    tenant,
    expiresAt: now + TENANT_HOST_CACHE_TTL_MS,
  })

  return tenant
}

export async function resolveTenantByHost(
  host: string | null | undefined,
): Promise<TenantContext> {
  const normalized = normalizeHost(host)

  if (normalized) {
    const tenant = await lookupTenantByCustomDomain(normalized)

    if (tenant && tenant.slug !== TOVIS_ROOT_TENANT_SLUG) {
      return whiteLabelTenantContext({ tenantId: tenant.id, slug: tenant.slug })
    }
  }

  return rootTenantContext(await getRootTenantId())
}
