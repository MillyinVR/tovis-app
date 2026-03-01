// app/layout.tsx
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import '@/lib/brand/brand.css'

import { BrandProvider } from '@/lib/brand/BrandProvider'
import RoleFooter from '@/app/_components/RoleFooter'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'TOVIS',
  description: 'TOVIS',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  cookies()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <BrandProvider>
          {/* Content padding so it never hides under footer */}
          <div style={{ paddingBottom: 'calc(var(--app-footer-space, 0px) + env(safe-area-inset-bottom))' }}>
            {children}
          </div>

          {/* ✅ Always-present portal host + mount */}
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

          {/* ✅ Footer chooser (renders FooterShell) */}
          <RoleFooter />
        </BrandProvider>
      </body>
    </html>
  )
}