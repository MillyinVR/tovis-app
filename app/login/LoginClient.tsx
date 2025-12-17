// app/login/LoginClient.tsx
'use client'

import { useSearchParams } from 'next/navigation'
// import your existing Login form/component stuff here

export default function LoginClient() {
  const sp = useSearchParams()
  const from = sp.get('from') || '/'

  // paste your existing login UI here
  // and use `from` wherever you were using search params before

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      {/* your existing login form */}
      <div style={{ fontSize: 12, color: '#6b7280' }}>After login → {from}</div>
    </main>
  )
}
