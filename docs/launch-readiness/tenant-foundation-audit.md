# Tenant Foundation Audit

Audit date: 2026-06-10  
Scope: Phase 2 launch-readiness audit of tenant/white-label foundation status  
Current status: PARTIAL FOUNDATION / NOT PRIVATE-BETA SCOPE  

White-label SaaS readiness is not required for the first private beta unless Tori explicitly scopes it into that launch. The tenant foundation has moved beyond the older checklist state, but it is not complete white-label readiness.

---

# Tracked Foundation Pieces

| Area | Status | Evidence |
|---|---|---|
| Tenant model decision doc | DONE | `docs/architecture/tenant-model.md` |
| Tenant Prisma model | DONE | `prisma/schema.prisma` contains `model Tenant` |
| Expand-phase tenant migration | DONE | `prisma/migrations/20260610090000_add_tenant_foundation/migration.sql` |
| Root tenant seed | DONE | `prisma/seed.cjs` seeds `tovis-root` |
| Tenant backfill script | DONE | `prisma/scripts/backfillTenantFoundation.ts` |
| Tenant resolver | DONE | `lib/tenant/resolveTenant.ts` |
| Tenant visibility helper | DONE | `lib/tenant/visibility.ts` |
| Tenant-aware discovery guard | DONE | `tools/check-tenant-aware-discovery.mjs`, `pnpm check:tenant-aware-discovery` |
| Search route tenant context use | DONE | `app/api/search/route.ts`, `app/api/search/pros/route.ts` |
| Tenant isolation tests | DONE | `tests/integration/tenant-isolation.test.ts` |

---

# Untracked Tenant Work

The current worktree includes these untracked tenant files:

| File | Purpose | Audit treatment |
|---|---|---|
| `lib/tenant/requestContext.ts` | Request-to-tenant-context helper using request host. | Useful foundation, but not launch evidence until tracked/committed. |
| `lib/tenant/requestContext.test.ts` | Unit coverage for request host tenant resolution. | Useful coverage, but not launch evidence until tracked/committed. |
| `lib/tenant/bookingAttribution.ts` | Booking tenant-attribution snapshot helper. | Useful foundation, but not launch evidence until tracked/committed and wired into booking create path. |
| `lib/tenant/bookingAttribution.test.ts` | Unit coverage for tenant-attribution snapshots. | Useful coverage, but not launch evidence until tracked/committed. |

Recommendation: before final Phase 2 proof, either commit these files intentionally with their relevant wiring/tests or move them out of the launch proof worktree. Do not treat them as completed launch evidence while they remain untracked.

---

# Verification Run

Status: PASS LOCALLY  
Date: 2026-06-10  
Command:

```bash
pnpm exec vitest run --config vitest.config.mts \
  lib/tenant/resolveTenant.test.ts \
  lib/tenant/visibility.test.ts \
  lib/tenant/requestContext.test.ts \
  lib/tenant/bookingAttribution.test.ts \
  app/api/search/route.test.ts
```

Result:

```text
Test Files: 5 passed
Tests: 27 passed
```

This proves the current tracked and untracked tenant helper tests pass locally. It does not make untracked files launch evidence until they are intentionally committed or excluded.

---

# Remaining Tenant/White-Label Gaps

| Gap | Status | Launch impact |
|---|---|---|
| Launch-env tenant backfill proof | TODO | Required if white-label or tenant-attributed analytics is scoped into launch |
| Tenant attribution wired into booking creation | PARTIAL / VERIFY | Required before tenant revenue/acquisition reporting can be trusted |
| Client signup tenant assignment | TODO | Required before white-label signup |
| Pro/admin tenant management UI | TODO | Required before partner handoff |
| Tenant-specific branding resolution | PARTIAL | Required before white-label experience |
| Tenant-specific Postmark/Twilio identity | TODO | Required before white-label communications |
| Tenant-specific Stripe/revenue handling | TODO | Required before white-label monetization |
| Partner admin/support roles | TODO | Required before enterprise handoff |
| Deployed tenant isolation proof | TODO | Required before white-label launch |

---

# Phase 2 Decision

For first private beta:

```text
Tenant foundation: PARTIAL
White-label launch scope: OUT OF SCOPE unless explicitly added
Private beta blocker: No, unless white-label tenant behavior is included in beta scope
Public white-label rollout blocker: Yes
```

For final Phase 2 proof, record one of:

1. White-label remains out of private-beta scope.
2. White-label is added to scope and all tenant gaps above become launch blockers.
