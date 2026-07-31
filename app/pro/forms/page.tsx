// app/pro/forms/page.tsx
//
// K14 — the pro's consent form library (Phase 7 opens). Write a waiver, adopt a
// platform template, publish a revision, retire a form you no longer use.
//
// Dark by default: gated on the SAME `isClientTechnicalRecordEnabled` allowlist
// as the consent records these forms attach to. A pro who cannot see the
// technical record has no use for its forms, and two switches for one feature is
// how half a surface reaches a real pro.
import { notFound, redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { loadProConsentFormLibrary } from '@/lib/consentForms/loader'

import ConsentFormLibrary from './ConsentFormLibrary'

export const dynamic = 'force-dynamic'

export default async function ProFormsPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/forms')
  }

  const professionalId = user.professionalProfile.id

  // 404, not a redirect: with the flag off this page does not exist.
  if (!isClientTechnicalRecordEnabled(professionalId)) notFound()

  const library = await loadProConsentFormLibrary(professionalId)

  return (
    // The pro layout already wraps children in <main>; nesting a second one
    // would be invalid, and screen readers would announce two main landmarks.
    <section className="mx-auto grid max-w-3xl gap-4 p-4">
      <header className="grid gap-1">
        <h1 className="text-[20px] font-black text-textPrimary">
          Consent forms
        </h1>
        <p className="text-[12px] font-semibold text-textSecondary">
          The waivers and consent text you put in front of clients. Editing a form
          publishes a new version — records already signed keep the exact words
          they were signed against, so an old record never changes when you update
          the form.
        </p>
      </header>

      <ConsentFormLibrary
        forms={library.forms}
        templates={library.templates}
      />
    </section>
  )
}
