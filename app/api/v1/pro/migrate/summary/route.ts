// app/api/v1/pro/migrate/summary/route.ts
//
// Native read API for the pro migration wizard's two RSC-only screens — the
// entry/landing progress cards and the review/go-live summary. The web pages
// (app/pro/migrate/page.tsx + review/page.tsx) query Prisma directly via
// loadMigrationReviewSummary and pass a view-model into a client component, so
// there is no JSON endpoint the native app can read; this is it. Returns the
// same booking-gated counts both web screens show, so the native wizard never
// disagrees with the roster/calendar. Dark unless ENABLE_PRO_MIGRATION: 404s
// while the flag is off (matches every other migrate route + the page-layer
// redirect), so the native screen shows its "not available yet" state.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import type { ProMigrationSummaryResponseDTO } from '@/lib/dto/proMigration'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import { loadMigrationReviewSummary } from '@/lib/migration/migrationReview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  if (!isProMigrationEnabled()) return jsonFail(404, 'Not found')

  const summary = await loadMigrationReviewSummary(auth.professionalId)

  return jsonOk({ summary } satisfies ProMigrationSummaryResponseDTO, 200)
}
