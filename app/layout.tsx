// app/layout.tsx
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Inter_Tight, Fraunces, JetBrains_Mono } from 'next/font/google'

import './globals.css'
import '@/lib/brand/brand.css'

import { BrandProvider } from '@/lib/brand/BrandProvider'
import RoleFooter from '@/app/_components/RoleFooter'
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

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono-face',
  subsets: ['latin'],
  weight: ['400', '500'],
})

export const dynamic = 'force-dynamic'

const _brand = getBrandConfig()
export const metadata: Metadata = {
  title: _brand.displayName,
  description: _brand.tagline ?? _brand.displayName,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  cookies()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${interTight.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}>
        <BrandProvider>
          <div style={{ paddingBottom: 'calc(var(--app-footer-space, 0px) + env(safe-area-inset-bottom))' }}>
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
