// lib/tenant/resolveTenant.ts
//
// Request → tenant context. Skeleton for the white-label domain resolver
// (Q2 wires this into middleware/layouts). Resolution rule:
//
//   1. If the request host exactly matches an active tenant's customDomain,
//      resolve that white-label tenant.
//   2. Otherwise resolve the reserved root tenant (tovis-root).
//
// The root Tenant row must exist (created by seed/backfill). Resolving
// before the backfill has run is a deployment-order bug, so it throws
// loudly instead of inventing a tenant.

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

export async function getRootTenantId(): Promise<string> {
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

export async function resolveTenantByHost(
  host: string | null | undefined,
): Promise<TenantContext> {
  const normalized = normalizeHost(host)

  if (normalized) {
    const tenant = await prisma.tenant.findFirst({
      where: { customDomain: normalized, isActive: true },
      select: { id: true, slug: true },
    })

    if (tenant && tenant.slug !== TOVIS_ROOT_TENANT_SLUG) {
      return whiteLabelTenantContext({ tenantId: tenant.id, slug: tenant.slug })
    }
  }

  return rootTenantContext(await getRootTenantId())
}
