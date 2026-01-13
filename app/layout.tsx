// app/layout.tsx
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

// ✅ brand system
import '@/lib/brand/brand.css'
import { BrandProvider } from '@/lib/brand/BrandProvider'

import { getCurrentUser } from '@/lib/currentUser'
import ProFooterGate from '@/app/_components/ProFooterGate'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'TOVIS',
  description: 'TOVIS',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const user = await getCurrentUser().catch(() => null)
  const isPro = user?.role === 'PRO'

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <BrandProvider>
          {children}
          <ProFooterGate isPro={isPro} />
        </BrandProvider>
      </body>
    </html>
  )
}
