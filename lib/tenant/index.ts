// lib/tenant — canonical multi-tenancy module.
// See docs/architecture/tenant-model.md.
export { tenantCacheScope } from './cacheScope'
export { TOVIS_ROOT_TENANT_NAME, TOVIS_ROOT_TENANT_SLUG } from './constants'
export {
  rootTenantContext,
  whiteLabelTenantContext,
  type TenantContext,
} from './context'
export {
  ensureRootTenant,
  getRootTenantId,
  normalizeHost,
  resolveTenantByHost,
} from './resolveTenant'
export { resolveTenantContextForRequest } from './requestContext'
export {
  bookingTenantVisibilityFilter,
  nfcCardTenantVisibilityFilter,
  platformCrossTenantProVisibilityFilter,
  proDiscoveryVisibilityFilter,
  searchIndexVisibilityFilter,
  searchIndexVisibilitySql,
} from './visibility'
