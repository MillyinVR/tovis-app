// app/pro/layout.tsx

import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'
import '@/lib/brand/proOverview.css'
import { checkProReadiness } from '@/lib/pro/readiness/proReadiness'
import { getProOnboardingRedirectHref } from '@/lib/pro/readiness/onboardingGate'
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
  const publicUrl = isPubliclyApprovedProStatus(pro.verificationStatus)
    ? `/professionals/${encodeURIComponent(pro.id)}`
    : null

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <ProHeader
        businessName={pro.businessName}
        subtitle={pro.handle ? `@${pro.handle}` : null}
        publicUrl={publicUrl}
      />
      <ProComplianceBanner />
      <ProReadinessBanner />

      <main className="brand-pro-layout-main">{children}</main>

      {modal}
    </div>
  )
}