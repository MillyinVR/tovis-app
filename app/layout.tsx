// app/layout.tsx
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import '@/lib/brand/brand.css'

import { BrandProvider } from '@/lib/brand/BrandProvider'
import RoleFooter from '@/app/_components/RoleFooter'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'TOVIS',
  description: 'TOVIS',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 🔒 Keep request-bound so role/footer logic never caches incorrectly
  cookies()

  return (
    <html lang="en">
      <head>
        {/* 🗺️ Leaflet styles for map-first search (no JS, safe in head) */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>

      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {/* 🌿 Client-only brand + theme provider */}
        <BrandProvider>
          {/* 
            Global padding so fixed footer never overlaps content.
            Footer sets --app-footer-space dynamically.
          */}
          <div style={{ paddingBottom: 'var(--app-footer-space, 0px)' }}>
            {children}
          </div>
        </BrandProvider>

        {/* ⚠️ Must stay OUTSIDE client providers */}
        <RoleFooter />
      </body>
    </html>
  )
}
