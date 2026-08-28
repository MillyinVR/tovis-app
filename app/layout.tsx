// app/layout.tsx

import type { Metadata, Viewport } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { cookies } from 'next/headers'
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/next'

import './globals.css'
import '@/lib/brand/brand.css'
import '@/lib/brand/proOverview.css'
import '@/lib/brand/proSession.css'
import '@/lib/brand/proCalendar.css'
import '@/lib/brand/proLastMinute.css'
import '@/lib/brand/proFinance.css'

import RoleFooter from '@/app/_components/RoleFooter'
import { ErrorHomeProvider } from '@/app/_components/boundaries/ErrorHomeProvider'
import { resolveErrorHome } from '@/app/_components/boundaries/errorHomeHref'
import WorkspaceSwitchLauncher from '@/app/_components/WorkspaceSwitchLauncher/WorkspaceSwitchLauncher'
import WorkspaceMismatchProvider from '@/app/_components/WorkspaceMismatchProvider'
import { BrandProvider } from '@/lib/brand/BrandProvider'
import { THEME_INIT_SCRIPT } from '@/lib/brand/theme'
import { rgbTripletToHex } from '@/lib/brand/eyeSvg'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { Z } from '@/lib/zIndex'

// The brand sheet is served from app/fonts/ rather than next/font/google: that
// loader downloads the binaries from fonts.gstatic.com at BUILD time, and when
// Google rotated Hanken Grotesk's file hashes the retired URL 404'd and took the
// whole build down with it (see app/fonts/README.md for the exact error). Local
// files take the network out of every build — CI, preview and prod alike.
// Runtime is unchanged either way: next/font already self-hosted these, so no
// user's browser ever requested them from Google.

// Body / UI — Hanken Grotesk (brand sheet)
const hankenGrotesk = localFont({
  variable: '--font-body',
  display: 'swap',
  src: [
    {
      // Variable file: one src covers the whole 400–800 range the UI uses, which
      // is exactly what Google was serving — it returned this same file for
      // every weight in the old request.
      path: './fonts/hanken-grotesk-variable.woff2',
      weight: '400 800',
      style: 'normal',
    },
  ],
})

// Display / headlines / wordmark — Space Grotesk
const spaceGrotesk = localFont({
  variable: '--font-display-face',
  display: 'swap',
  src: [
    {
      path: './fonts/space-grotesk-variable.woff2',
      weight: '400 700',
      style: 'normal',
    },
  ],
})

// Labels / timestamps / system texture — Space Mono
// No variable version exists upstream, so these stay two static faces.
const spaceMono = localFont({
  variable: '--font-mono-face',
  display: 'swap',
  src: [
    { path: './fonts/space-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/space-mono-700.woff2', weight: '700', style: 'normal' },
  ],
})

export const dynamic = 'force-dynamic'

type RootLayoutProps = {
  children: ReactNode
}

const bodyClassName = [
  hankenGrotesk.variable,
  spaceGrotesk.variable,
  spaceMono.variable,
].join(' ')

const appContentStyle: CSSProperties = {
  paddingBottom:
    'calc(var(--app-footer-space, 0px) + env(safe-area-inset-bottom))',
}

const footerHostStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  zIndex: Z.footer,
  pointerEvents: 'none',
}

const footerMountStyle: CSSProperties = {
  width: '100%',
  pointerEvents: 'auto',
}

export async function generateMetadata(): Promise<Metadata> {
  const tenantContext = await resolveTenantContextForLayout()
  const brand = getBrandForTenantContext(tenantContext)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  return {
    metadataBase: appUrl ? new URL(appUrl) : undefined,
    title: brand.displayName,
    description: brand.tagline ?? brand.displayName,
    applicationName: brand.displayName,
    appleWebApp: {
      capable: true,
      title: brand.displayName,
      statusBarStyle: 'black-translucent',
    },
  }
}

// Browser UI color follows the page background per color scheme.
export async function generateViewport(): Promise<Viewport> {
  const tenantContext = await resolveTenantContextForLayout()
  const brand = getBrandForTenantContext(tenantContext)

  return {
    // viewport-fit: cover lets env(safe-area-inset-*) resolve to real notch /
    // home-indicator insets inside the iOS/Android webview wrappers.
    viewportFit: 'cover',
    themeColor: [
      {
        media: '(prefers-color-scheme: dark)',
        color: rgbTripletToHex(brand.tokensByMode.dark.colors.bgPrimary),
      },
      {
        media: '(prefers-color-scheme: light)',
        color: rgbTripletToHex(brand.tokensByMode.light.colors.bgPrimary),
      },
    ],
  }
}

export default async function RootLayout({ children }: RootLayoutProps) {
  await cookies()

  const tenantContext = await resolveTenantContextForLayout()
  const brand = getBrandForTenantContext(tenantContext)

  // Resolved here, not in the boundaries: a client error.tsx cannot read the
  // httpOnly session itself. Cookie read + JWT verify, no database round-trip
  // (see errorHomeHref), and the layout is already force-dynamic.
  const errorHome = await resolveErrorHome()

  return (
    <html lang="en" data-mode="dark" className={bodyClassName} suppressHydrationWarning>
      <body>
        {/* No-flash theme init: applies the resolved light/dark mode to
            <html> before first paint (reads localStorage, falls back to the
            device's prefers-color-scheme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <BrandProvider brand={brand}>
          <ErrorHomeProvider value={errorHome}>
            <div style={appContentStyle}>{children}</div>
          </ErrorHomeProvider>

          <div id="tovis-footer-host" style={footerHostStyle}>
            <div id="tovis-footer-mount" style={footerMountStyle} />
          </div>

          <RoleFooter />
          <WorkspaceSwitchLauncher />
          <WorkspaceMismatchProvider />
        </BrandProvider>
        <Analytics />
      </body>
    </html>
  )
}