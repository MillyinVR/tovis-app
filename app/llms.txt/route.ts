// app/llms.txt/route.ts
//
// Serves the llms.txt convention file (see lib/seo/llmsText.ts). Tenant-
// resolved so a white-label host describes its own brand.
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { buildLlmsText } from '@/lib/seo/llmsText'
import { resolveTenantContextForRequest } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const brand = getBrandForTenantContext(
    await resolveTenantContextForRequest(req),
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
