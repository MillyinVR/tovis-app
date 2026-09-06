// app/llms.txt/route.ts
//
// Serves the llms.txt convention file (see lib/seo/llmsText.ts). Tenant-
// resolved so a white-label host describes its own brand.
//
// The tenant context is read for the brand and nothing else, and this is the
// route's only DB touch — so a DB outage degrades to the root brand instead
// of a 500 (Sentry 8b2421fae1654089b0b89878c95e3867, staging, 2026-09-05:
// the layout fell back cleanly while this route threw).
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { buildLlmsText } from '@/lib/seo/llmsText'
import { resolveBrandOnlyTenantContextForRequest } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const brand = getBrandForTenantContext(
    await resolveBrandOnlyTenantContextForRequest(req),
  )

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(req.url).origin

  return new Response(
    buildLlmsText({
      brandDisplayName: brand.displayName,
      baseUrl: base,
    }),
    {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    },
  )
}
