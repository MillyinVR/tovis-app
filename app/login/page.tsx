// app/login/page.tsx
import { Suspense } from 'react'
import LoginClient from './LoginClient'

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16, fontFamily: 'system-ui' }}>Loading…</div>}>
      <LoginClient />
    </Suspense>
  )
}
