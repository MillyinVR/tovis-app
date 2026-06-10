// lib/tenant/visibility.ts
//
// Single source of truth for tenant visibility `where` fragments.
// Discovery surfaces must compose these helpers instead of writing tenant
// clauses inline — enforced by tools/check-tenant-aware-discovery.mjs.
//
// Asymmetric rule (docs/architecture/tenant-model.md):
// - root tenant context (tovis-root) sees everything: empty filter
// - white-label context sees only rows belonging to its own tenant
//
// Fail-closed note for the expand phase: rows whose tenant column is still
// NULL (not yet backfilled) do NOT match an equality filter, so white-label
// contexts can never see un-attributed rows. Root context is unaffected.

import type { Prisma } from '@prisma/client'

import type { TenantContext } from './context'

/**
 * Merge into every Pro discovery query (search, discover, looks-by-pro,
 * NFC claim, last-minute fan-out).
 */
export function proDiscoveryVisibilityFilter(
  ctx: TenantContext,
): Prisma.ProfessionalProfileWhereInput {
  if (ctx.isRoot) return {}
  return { homeTenantId: ctx.tenantId }
}

/**
 * Same rule projected through the ProfessionalSearchIndex relation, for
 * queries that hit the search index instead of profiles directly.
 */
export function searchIndexVisibilityFilter(
  ctx: TenantContext,
): Prisma.ProfessionalSearchIndexWhereInput {
  if (ctx.isRoot) return {}
  return { professional: { homeTenantId: ctx.tenantId } }
}

/**
 * Tenant scope for booking queries on tenant-facing surfaces
 * (admin/analytics). Revenue attribution follows the Pro's tenant.
 */
export function bookingTenantVisibilityFilter(
  ctx: TenantContext,
): Prisma.BookingWhereInput {
  if (ctx.isRoot) return {}
  return { proTenantId: ctx.tenantId }
}

/**
 * Tenant scope for NFC card queries (claim/admin surfaces).
 */
export function nfcCardTenantVisibilityFilter(
  ctx: TenantContext,
): Prisma.NfcCardWhereInput {
  if (ctx.isRoot) return {}
  return { tenantId: ctx.tenantId }
}
