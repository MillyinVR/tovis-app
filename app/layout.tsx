// app/layout.tsx
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

import '@/lib/brand/brand.css'
import { BrandProvider } from '@/lib/brand/BrandProvider'

import RoleFooter from '@/app/_components/RoleFooter'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'TOVIS',
  description: 'TOVIS',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <BrandProvider>
          {/* Global padding so fixed footer never covers content */}
          <div style={{ paddingBottom: 'var(--app-footer-space, 0px)' }}>
            {children}
          </div>

          {/* ✅ Single source of truth */}
          <RoleFooter />
        </BrandProvider>
      </body>
    </html>
  )
}
