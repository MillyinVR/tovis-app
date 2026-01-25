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
  cookies() // keeps this request-bound so role/footer doesn’t cache wrong

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {/* Client provider wraps content */}
        <BrandProvider>
          {/* Global padding so fixed footer never covers content */}
          <div style={{ paddingBottom: 'var(--app-footer-space, 0px)' }}>{children}</div>
        </BrandProvider>

        {/* ✅ Server footer must NOT be inside a client provider */}
        <RoleFooter />
      </body>
    </html>
  )
}
