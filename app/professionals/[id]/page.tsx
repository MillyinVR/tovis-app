// app/professionals/[id]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadProProfileSeoById } from '@/lib/profiles/proProfileSeo'
import { buildProProfileMetadata } from '@/lib/seo/proProfileMetadata'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { type PublicProfileSearchParams } from '@/lib/profiles/publicProfileFormatting'

import PublicProfileView from './_components/PublicProfileView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (!id) return {}

  let seo: Awaited<ReturnType<typeof loadProProfileSeoById>>
  try {
    seo = await loadProProfileSeoById(id)
  } catch {
    // Never let a metadata fetch failure 500 the page; fall back to defaults.
    return {}
  }
  if (!seo) return {}

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return buildProProfileMetadata({
    seo,
    canonicalPath: `/professionals/${id}`,
    brandDisplayName: brand.displayName,
  })
}

export default async function PublicProfessionalProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PublicProfileSearchParams>
}) {
  const { id } = await params
  if (!id) notFound()

  const resolvedSearchParams = searchParams ? await searchParams : undefined

  return <PublicProfileView id={id} searchParams={resolvedSearchParams} />
}
