// app/admin/_components/AdminGuard.tsx
import { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'

export default async function AdminGuard({ children }: { children: ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  if (!user) redirect('/login?from=/admin')
  if (user.role !== 'ADMIN') redirect('/')

  return <>{children}</>
}
