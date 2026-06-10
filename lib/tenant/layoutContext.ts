// lib/tenant/layoutContext.ts
//
// Tenant context for server components (layouts, pages, generateMetadata),
// which have no Request object — the host comes from next/headers. Wrapped
// in React cache() so the root layout, metadata, and any page that needs the
// context share one resolution per render pass.
//
// Failure mode: page rendering must not hard-down on a DB blip (marketing
// pages have no other DB dependency), so resolution errors fall back to a
// degraded root context instead of throwing. On a white-label domain that
// means root branding for the duration of the outage — acceptable next to
// serving a 500 on every page. This is an error path only; normal white-label
// resolution never falls back by host or env (see lib/brand/forTenant.ts).

import { cache } from 'react'
import { headers } from 'next/headers'

import { rootTenantContext, type TenantContext } from './context'
import { resolveTenantByHost } from './resolveTenant'

// Sentinel id for the degraded fallback context. It is only ever used for
// brand resolution (a root context short-circuits to the root brand without
// touching the id); anything that needs a real tenant id resolves its own
// context and keeps the loud-failure behavior.
const DEGRADED_ROOT_TENANT_ID = 'tenant-root-unresolved'

export const resolveTenantContextForLayout = cache(
  async (): Promise<TenantContext> => {
    const requestHeaders = await headers()
    const host =
      requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')

    try {
      return await resolveTenantByHost(host)
    } catch (error) {
      console.error('resolveTenantContextForLayout: falling back to root', {
        error: error instanceof Error ? error.message : String(error),
      })

      return rootTenantContext(DEGRADED_ROOT_TENANT_ID)
    }
  },
)
