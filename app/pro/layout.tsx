// app/pro/layout.tsx

import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { canListProPublicly } from '@/lib/proTrustState'
import '@/lib/brand/proOverview.css'
import { checkProReadiness } from '@/lib/pro/readiness/proReadiness'
import { getProOnboardingRedirectHref } from '@/lib/pro/readiness/onboardingGate'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { buildWorkspaceOptions, workspaceCapabilityOf } from '@/lib/auth/workspaces'
import { RefreshOnFocus } from '@/app/_components/live/RefreshOnFocus'
import { LiveRefresh } from '@/app/_components/live/LiveRefresh'
import { liveChannelForPro, liveChannelForUser } from '@/lib/live/broadcast'
import ProHeader from './ProHeader'
import ProComplianceBanner from './ProComplianceBanner'
import ProReadinessBanner from './ProReadinessBanner'

export const dynamic = 'force-dynamic'

const PRO_HOME = '/pro/calendar'

function loginHref(
  from: string,
  reason?: 'PRO_REQUIRED' | 'PRO_SETUP_REQUIRED',
) {
  const base = `/login?from=${encodeURIComponent(from)}`
  return reason ? `${base}&reason=${encodeURIComponent(reason)}` : base
}

function verifyHref(next: string): string {
  return `/verify-phone?next=${encodeURIComponent(next)}`
}

function currentProPathFromHeaders(h: Headers): string {
  return (
    h.get('x-pathname') ??
    h.get('x-current-path') ??
    h.get('next-url') ??
    h.get('x-invoke-path') ??
    '/pro'
  )
}

export default async function ProRootLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal: ReactNode
}) {
  const user = await getCurrentUser().catch(() => null)

  if (!user) {
    redirect(loginHref(PRO_HOME))
  }

  if (user.role !== 'PRO') {
    redirect(loginHref(PRO_HOME, 'PRO_REQUIRED'))
  }

  if (!user.professionalProfile) {
    redirect(loginHref(PRO_HOME, 'PRO_SETUP_REQUIRED'))
  }

  if (user.sessionKind !== 'ACTIVE' || !user.isFullyVerified) {
    redirect(verifyHref(PRO_HOME))
  }

  const requestHeaders = await headers()
  const pathname = currentProPathFromHeaders(requestHeaders)

  const readiness = await checkProReadiness(user.professionalProfile.id)
  const onboardingRedirectHref = getProOnboardingRedirectHref({
    pathname,
    readiness,
  })

  if (onboardingRedirectHref) {
    redirect(onboardingRedirectHref)
  }

  const pro = user.professionalProfile
  const proDisplayName = pickProfessionalPublicDisplayName(pro)
  const publicUrl = canListProPublicly(pro.verificationStatus)
    ? `/professionals/${encodeURIComponent(pro.id)}`
    : null

  const workspaceOptions = buildWorkspaceOptions(
    workspaceCapabilityOf(user),
    user.role,
  )

  const liveChannels = [
    liveChannelForPro(pro.id),
    liveChannelForUser(user.id),
  ].filter((c): c is string => Boolean(c))

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <RefreshOnFocus />
      {/*
        Wraps the shell (rather than sitting beside it) so client-fetched pro
        surfaces — the calendar holds its rows in a hook, out of reach of
        `router.refresh()` — can re-run their own fetch off this same
        subscription via `useLiveChanged`.
      */}
      <LiveRefresh channels={liveChannels}>
        <ProHeader
          businessName={proDisplayName}
          subtitle={pro.handle ? `@${pro.handle}` : null}
          publicUrl={publicUrl}
          migrationEnabled={isProMigrationEnabled()}
          formsEnabled={isClientTechnicalRecordEnabled(pro.id)}
          workspaceOptions={workspaceOptions}
        />

        {/*
          The banners live INSIDE the scrolling content, below the space `main`
          reserves for the fixed header — not pinned alongside it.

          Pinning them is what hid them: the compliance banner cleared a
          hard-coded `top: 48px` and the readiness banner cleared nothing at all,
          so both rendered behind a 146px header with their links unclickable.
          Pinning them *correctly* is no better on a phone — an unready pro can
          show both at once (the gate deliberately lets unready pros reach
          /pro/calendar to edit working hours), and 444px of pinned chrome on a
          375x667 screen leaves 223px of calendar and pushes the view tabs off
          the bottom.

          In flow they are fully visible and clickable, and they scroll away, so
          the page below always gets the viewport minus the header.
        */}
        <main className="brand-pro-layout-main">
          <ProComplianceBanner />
          <ProReadinessBanner />

          {children}
        </main>

        {modal}
      </LiveRefresh>
    </div>
  )
}