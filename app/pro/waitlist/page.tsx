// app/pro/waitlist/page.tsx
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'

import WaitlistOutreachClient from './WaitlistOutreachClient'

export const dynamic = 'force-dynamic'

export default async function ProWaitlistPage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/waitlist')
  }

  return (
    <main className="mx-auto w-full max-w-[680px] px-[22px] pb-28 pt-10 md:px-8">
      <WaitlistOutreachClient />
    </main>
  )
}
