// lib/tenant/layoutContext.ts
//
// Tenant context for server components (layouts, pages, generateMetadata),
// which have no Request object — the host comes from next/headers. Wrapped
// in React cache() so the root layout, metadata, and any page that needs the
// context share one resolution per render pass.
//
// Failure mode: page rendering must not hard-down on a DB blip (marketing
// pages have no other DB dependency), so resolution errors degrade to the
// root context — see lib/tenant/degradedResolution.ts for the rule and the
// sentinel id. Anything that needs a real tenant id resolves its own context
// and keeps the loud-failure behavior.

import { cache } from 'react'
import { headers } from 'next/headers'

import type { TenantContext } from './context'
import { resolveTenantByHostOrDegraded } from './degradedResolution'

export const resolveTenantContextForLayout = cache(
  async (): Promise<TenantContext> => {
    const requestHeaders = await headers()
    const host =
      requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')

    return resolveTenantByHostOrDegraded(host, 'resolveTenantContextForLayout')
  },
)
