// app/signup/page.tsx
import { Suspense } from 'react'
import SignupClient from './SignupClient'

export default function SignupPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16, fontFamily: 'system-ui' }}>Loading…</div>}>
      <SignupClient />
    </Suspense>
  )
}
