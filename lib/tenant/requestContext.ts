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

import { resolveTenantByHost } from './resolveTenant'
import type { TenantContext } from './context'

export async function resolveTenantContextForRequest(
  request: Request,
): Promise<TenantContext> {
  return resolveTenantByHost(request.headers.get('host'))
}
