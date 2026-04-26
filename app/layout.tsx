// app/layout.tsx

import type { Metadata } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google'

import './globals.css'
import '@/lib/brand/brand.css'
import '@/lib/brand/proOverview.css'
import '@/lib/brand/proSession.css'
import '@/lib/brand/proCalendar.css'

import RoleFooter from '@/app/_components/RoleFooter'
import { BrandProvider } from '@/lib/brand/BrandProvider'
import { getBrandConfig } from '@/lib/brand'

const interTight = Inter_Tight({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const fraunces = Fraunces({
  variable: '--font-display-face',
  subsets: ['latin'],
  weight: ['300', '400', '600', '700'],
  style: ['normal', 'italic'],
})

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-mono-face',
  subsets: ['latin'],
  weight: ['400', '500'],
})

export const dynamic = 'force-dynamic'

type RootLayoutProps = {
  children: ReactNode
}

type BrandRequestInput = {
  host: string | null
}

const bodyClassName = [
  interTight.variable,
  fraunces.variable,
  jetBrainsMono.variable,
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
  zIndex: 999999,
  pointerEvents: 'none',
}

const footerMountStyle: CSSProperties = {
  width: '100%',
  pointerEvents: 'auto',
}

async function getBrandRequestInput(): Promise<BrandRequestInput> {
  const requestHeaders = await headers()
  const forwardedHost = requestHeaders.get('x-forwarded-host')
  const host = forwardedHost ?? requestHeaders.get('host')

  return {
    host,
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const brandInput = await getBrandRequestInput()
  const brand = getBrandConfig(brandInput)

  return {
    title: brand.displayName,
    description: brand.tagline ?? brand.displayName,
  }
}

export default async function RootLayout({ children }: RootLayoutProps) {
  await cookies()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={bodyClassName}>
        <BrandProvider>
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