// app/layout.tsx

import type { Metadata, Viewport } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { cookies } from 'next/headers'
import { Space_Grotesk, Hanken_Grotesk, Space_Mono } from 'next/font/google'

import './globals.css'
import '@/lib/brand/brand.css'
import '@/lib/brand/proOverview.css'
import '@/lib/brand/proSession.css'
import '@/lib/brand/proCalendar.css'
import '@/lib/brand/proLastMinute.css'

import RoleFooter from '@/app/_components/RoleFooter'
import { BrandProvider } from '@/lib/brand/BrandProvider'
import { THEME_INIT_SCRIPT } from '@/lib/brand/theme'
import { rgbTripletToHex } from '@/lib/brand/eyeSvg'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { Z } from '@/lib/zIndex'

// Body / UI — Hanken Grotesk (brand sheet)
const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

// Display / headlines / wordmark — Space Grotesk
const spaceGrotesk = Space_Grotesk({
  variable: '--font-display-face',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

// Labels / timestamps / system texture — Space Mono
const spaceMono = Space_Mono({
  variable: '--font-mono-face',
  subsets: ['latin'],
  weight: ['400', '700'],
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

  return (
    <html lang="en" data-mode="dark" className={bodyClassName} suppressHydrationWarning>
      <body>
        {/* No-flash theme init: applies the resolved light/dark mode to
            <html> before first paint (reads localStorage, falls back to the
            device's prefers-color-scheme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <BrandProvider brand={brand}>
          <div style={appContentStyle}>{children}</div>

          <div id="tovis-footer-host" style={footerHostStyle}>
            <div id="tovis-footer-mount" style={footerMountStyle} />
          </div>

          <RoleFooter />
        </BrandProvider>
      </body>
    </html>
  )
}