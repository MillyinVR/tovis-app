// app/pro/viral-requests/page.tsx
//
// The pro's side of viral looks — the destination that never existed.
//
// An approved viral look fans out to every pro whose services match, and each
// match has always produced a PRO notification. Its href pointed at
// `/admin/viral-requests/{id}`: an admin route, and one that 404s for an admin
// too (there is only a list page). tovis-app #1189 dropped the dead href; this
// is what replaces it.
//
// Not flag-gated. Unlike the consent-form library there is no allowlist to sit
// behind: a pro either was matched to a look or was not, and a pro with no
// matches sees an honest empty state rather than a hidden page.
import { redirect } from 'next/navigation'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { buildProViralRequestListDTO } from '@/lib/dto/proViralRequests'
import { getCurrentUser } from '@/lib/currentUser'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { loadProViralRequestLibrary } from '@/lib/viralRequests/proLibrary'

import ViralRequestLibrary from './ViralRequestLibrary'

export const dynamic = 'force-dynamic'

export default async function ProViralRequestsPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/viral-requests')
  }

  // The same loader AND the same DTO the API route serves, so the page, the
  // phone and this component cannot disagree about which looks matched, whether
  // this pro is offering one, or how a date is spelled.
  const entries = await loadProViralRequestLibrary(user.professionalProfile.id)
  const { requests } = buildProViralRequestListDTO(entries)
  // The count a pro reads here is the same platform-wide number the client
  // reads, so it carries the same scope in its wording — resolved per tenant
  // rather than written as a literal.
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return (
    // The pro layout already provides <main>; a second one would be invalid and
    // would announce two main landmarks.
    <section className="mx-auto grid max-w-3xl gap-4 p-4">
      <header className="grid gap-1">
        <h1 className="text-[20px] font-black text-textPrimary">
          Viral requests
        </h1>
        <p className="text-[12px] font-semibold text-textSecondary">
          Looks clients have asked for that match the services you offer. Say you
          can do one and you&rsquo;ll be listed as offering it &mdash; clients
          browsing that look can find you. You can change your mind at any time.
        </p>
      </header>

      <ViralRequestLibrary
        initialRequests={requests}
        brandName={brand.displayName}
      />
    </section>
  )
}
