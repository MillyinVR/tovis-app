// lib/seo/proProfileMetadata.ts
//
// Shared Next Metadata builder for the two public pro profile surfaces
// (/professionals/[id] and /p/[handle]). Both canonicalize to the
// /professionals/[id] URL so search engines consolidate signals onto one
// page instead of splitting them across the vanity mirror.
import type { Metadata } from 'next'

import type { ProProfileSeo } from '@/lib/profiles/proProfileSeo'

const DESCRIPTION_MAX = 160

export function buildProProfileMetadata(args: {
  seo: ProProfileSeo
  /** Root-relative canonical path, resolved against metadataBase. */
  canonicalPath: string
  /** Tenant-resolved brand display name (never hardcoded). */
  brandDisplayName: string
}): Metadata {
  const { seo, canonicalPath, brandDisplayName } = args
  const { header } = seo

  const place =
    seo.city && seo.state
      ? `${seo.city}, ${seo.state}`
      : (seo.city ?? seo.state)

  const titleCore = place
    ? `${header.displayName} — ${header.professionLabel} in ${place}`
    : `${header.displayName} — ${header.professionLabel}`
  const title = `${titleCore} | ${brandDisplayName}`

  const description =
    header.bio && header.bio.trim().length > 0
      ? header.bio.trim().slice(0, DESCRIPTION_MAX)
      : `Book ${header.professionLabel.toLowerCase()} services with ${header.displayName} on ${brandDisplayName}.`

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      type: 'profile',
      title: titleCore,
      description,
      url: canonicalPath,
      ...(header.avatarUrl ? { images: [{ url: header.avatarUrl }] } : {}),
    },
    twitter: {
      card: header.avatarUrl ? 'summary_large_image' : 'summary',
      title: titleCore,
      description,
      ...(header.avatarUrl ? { images: [header.avatarUrl] } : {}),
    },
  }
}
