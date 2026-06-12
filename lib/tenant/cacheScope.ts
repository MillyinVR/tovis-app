// lib/tenant/cacheScope.ts

import type { TenantContext } from './context'

export function tenantCacheScope(ctx: TenantContext): string {
  return ctx.isRoot ? 'root' : `tenant:${ctx.tenantId}`
}
