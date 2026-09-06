// lib/tenant/requestContext.ts
//
// Request → TenantContext for tenant-facing surfaces (search, discovery).
//
// Resolution today is host-based: a request arriving on a tenant's custom
// domain gets that white-label context; everything else is tovis-root. Per
// docs/architecture/tenant-model.md, white-label clients sign up under
// their tenant's domain, so the host is the primary signal. Layering the
// logged-in client's homeTenant on top is a WS-6/WS-9 follow-up once
// white-label signup exists.
//
// Two resolvers, one rule for choosing between them:
//
//   resolveTenantContextForRequest          the tenant id is load-bearing —
//                                           authorization, visibility filters,
//                                           writes. A failed lookup THROWS so
//                                           the handler fails loudly (Next
//                                           reports it via onRequestError).
//   resolveBrandOnlyTenantContextForRequest the context is read only to pick
//                                           a brand for public, unauthenticated
//                                           output (llms.txt, the checkout
//                                           bounce page). A failed lookup
//                                           degrades to the root brand — see
//                                           lib/tenant/degradedResolution.ts.
//
// A handler that touches `tenantId` for anything but getBrandForTenantContext
// must use the first; the degraded context's id is a sentinel, not a row.

import type { TenantContext } from './context'
import { resolveTenantByHostOrDegraded } from './degradedResolution'
import { resolveTenantByHost } from './resolveTenant'

export async function resolveTenantContextForRequest(
  request: Request,
): Promise<TenantContext> {
  return resolveTenantByHost(request.headers.get('host'))
}

export async function resolveBrandOnlyTenantContextForRequest(
  request: Request,
): Promise<TenantContext> {
  return resolveTenantByHostOrDegraded(
    request.headers.get('host'),
    'resolveBrandOnlyTenantContextForRequest',
  )
}
