// lib/tenant/degradedResolution.ts
//
// The one place a tenant lookup is allowed to fail soft.
//
// Surfaces that read the tenant context ONLY to pick a brand — page shells,
// llms.txt, the checkout bounce page — have no other DB dependency, so they
// must not hard-down on a DB blip. A resolution error falls back to a
// degraded root context instead of throwing. On a white-label domain that
// means root branding for the duration of the outage — acceptable next to
// serving a 500. This is an error path only; normal white-label resolution
// never falls back by host or env (see lib/brand/forTenant.ts).
//
// Both entry points (resolveTenantContextForLayout for server components,
// resolveBrandOnlyTenantContextForRequest for route handlers) go through
// here so the fallback and its log line exist exactly once.

import { rootTenantContext, type TenantContext } from './context'
import { resolveTenantByHost } from './resolveTenant'

// Sentinel id for the degraded fallback context. It is only ever used for
// brand resolution (a root context short-circuits to the root brand without
// touching the id); anything that needs a real tenant id — authorization,
// visibility filters, writes — resolves its own context through
// resolveTenantContextForRequest and keeps the loud-failure behavior.
export const DEGRADED_ROOT_TENANT_ID = 'tenant-root-unresolved'

/**
 * `resolveTenantByHost`, degrading to the root context on failure. `caller`
 * names the resolver in the log line so an outage can be traced to the
 * surface that observed it.
 */
export async function resolveTenantByHostOrDegraded(
  host: string | null | undefined,
  caller: string,
): Promise<TenantContext> {
  try {
    return await resolveTenantByHost(host)
  } catch (error) {
    console.error(`${caller}: falling back to root`, {
      error: error instanceof Error ? error.message : String(error),
    })

    return rootTenantContext(DEGRADED_ROOT_TENANT_ID)
  }
}
