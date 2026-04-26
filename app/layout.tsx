// app/layout.tsx
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google'

import './globals.css'
import '@/lib/brand/brand.css'
import '@/lib/brand/proOverview.css'

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

const brand = getBrandConfig()

export const metadata: Metadata = {
  title: brand.displayName,
  description: brand.tagline ?? brand.displayName,
}

type RootLayoutProps = {
  children: ReactNode
}

export default async function RootLayout({ children }: RootLayoutProps) {
  await cookies()

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${interTight.variable} ${fraunces.variable} ${jetBrainsMono.variable}`}
      >
        <BrandProvider>
          <div
            style={{
              paddingBottom:
                'calc(var(--app-footer-space, 0px) + env(safe-area-inset-bottom))',
            }}
          >
            {children}
          </div>

          <div
            id="tovis-footer-host"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              zIndex: 999999,
              pointerEvents: 'none',
            }}
          >
            <div
              id="tovis-footer-mount"
              style={{
                width: '100%',
                pointerEvents: 'auto',
              }}
            />
          </div>

          <RoleFooter />
        </BrandProvider>
      </body>
    </html>
  )
}