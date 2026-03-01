// app/(main)/layout.tsx
import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'

export default async function MainLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-bgPrimary text-textPrimary">{children}</div>
}