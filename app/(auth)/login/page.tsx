// app/(auth)/login/page.tsx
import { Suspense } from 'react'
import BrandLoader from '@/lib/brand/BrandLoader'
import LoginClient from '../_components/login/LoginClient'

export default function LoginPage() {
  return (
    <Suspense fallback={<BrandLoader variant="inline" />}>
      <LoginClient />
    </Suspense>
  )
}