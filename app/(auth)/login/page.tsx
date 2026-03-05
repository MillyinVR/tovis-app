// app/(auth)/login/page.tsx
import { Suspense } from 'react'
import LoginClient from '../_components/login/LoginClient'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-textSecondary">Loading…</div>}>
      <LoginClient />
    </Suspense>
  )
}