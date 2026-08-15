// app/(main)/looks/[id]/page.tsx
import { cache } from 'react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { parseLooksDetailResponse } from '@/lib/looks/parsers'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import LookDetailClient from './LookDetailClient'
import { pickString } from '@/lib/pick'
import { readErrorMessageOr } from '@/lib/http'

export const dynamic = 'force-dynamic'

type Params = { id: string }

async function getBaseUrl(): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host')

  if (!host) {
    throw new Error('Missing request host while loading look detail.')
  }

  return `${proto}://${host}`
}

async function fetchLookDetail(lookPostId: string) {
  const baseUrl = await getBaseUrl()

  const res = await fetch(
    `${baseUrl}/api/v1/looks/${encodeURIComponent(lookPostId)}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (res.status === 404) {
    notFound()
  }

  const raw: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(
      readErrorMessageOr(raw, 'Couldn’t load that look. Try again.'),
    )
  }

  const item = parseLooksDetailResponse(raw)
  if (!item) {
    throw new Error('Invalid look detail response shape.')
  }

  return item
}

// Memoized per request so generateMetadata and the page render share one fetch.
const getLookDetail = cache(fetchLookDetail)

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const resolved = await params
  const lookPostId = pickString(resolved.id)

  if (!lookPostId) return {}

  let item: Awaited<ReturnType<typeof fetchLookDetail>>
  try {
    item = await getLookDetail(lookPostId)
  } catch {
    // Don't let a metadata fetch failure 500 the page; fall back to defaults.
    return {}
  }

  // Brand copy is tenant-resolved (white-label aware), never hardcoded.
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  const proName = formatProfessionalPublicDisplayName(item.professional)
  // Client-authored looks are credited to the publishing client (handle only).
  const posterName = item.clientAuthor
    ? `@${item.clientAuthor.handle}`
    : proName
  const caption = item.caption?.trim() ?? ''

  const title = caption
    ? `${caption.slice(0, 80)} — ${posterName}`
    : `A look by ${posterName}`
  const description = caption
    ? caption.slice(0, 160)
    : `Discover this look by ${posterName} on ${brand.displayName} — then make your booking.`

  const image = item.primaryMedia.thumbUrl ?? item.primaryMedia.url
  const isVideo = item.primaryMedia.mediaType === 'VIDEO'

  return {
    title,
    description,
    openGraph: {
      type: isVideo ? 'video.other' : 'article',
      title,
      description,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default async function LookDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const resolved = await params
  const lookPostId = pickString(resolved.id)

  if (!lookPostId) {
    notFound()
  }

  const item = await getLookDetail(lookPostId)
  return <LookDetailClient initialItem={item} />
}