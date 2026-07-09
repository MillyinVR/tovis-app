// app/p/[handle]/page.tsx
//
// Vanity profile route. `<handle>.tovis.me` rewrites here (see proxy.ts), and
// NFC-card taps for premium pros link here too. It resolves the handle to a
// ProfessionalProfile id and renders the *full* public profile in place — the
// same surface as `/professionals/[id]` — so the vanity link is a real landing
// experience, not a stripped link-in-bio card. SEO still canonicalizes to the
// id-keyed route so search signals consolidate on one URL.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { normalizeHandle } from '@/lib/handles'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadProProfileSeoByHandle } from '@/lib/profiles/proProfileSeo'
import { buildProProfileMetadata } from '@/lib/seo/proProfileMetadata'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { type PublicProfileSearchParams } from '@/lib/profiles/publicProfileFormatting'

import PublicProfileView from '@/app/professionals/[id]/_components/PublicProfileView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const normalized = normalizeHandle(handle)
  if (!normalized) return {}

  let seo: Awaited<ReturnType<typeof loadProProfileSeoByHandle>>
  try {
    seo = await loadProProfileSeoByHandle(normalized)
  } catch {
    // Never let a metadata fetch failure 500 the page; fall back to defaults.
    return {}
  }
  if (!seo) return {}

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return buildProProfileMetadata({
    seo,
    // The vanity mirror canonicalizes to the full profile route so search
    // signals consolidate on one URL.
    canonicalPath: `/professionals/${seo.header.id}`,
    brandDisplayName: brand.displayName,
  })
}

export default async function VanityProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams?: Promise<PublicProfileSearchParams>
}) {
  const { handle } = await params
  const normalized = normalizeHandle(handle)
  if (!normalized) notFound()

  const pro = await prisma.professionalProfile.findUnique({
    where: { handleNormalized: normalized },
    select: { id: true },
  })

  if (!pro) notFound()

  const resolvedSearchParams = searchParams ? await searchParams : undefined

  return <PublicProfileView id={pro.id} searchParams={resolvedSearchParams} />
}
