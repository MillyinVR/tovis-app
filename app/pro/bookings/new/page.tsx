// app/pro/bookings/new/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewBookingForm from './NewBookingForm'

export default async function NewBookingPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const { clientId } = await props.searchParams
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings/new')
  }

  const db: any = prisma

  const clients = await db.clientProfile.findMany({
    include: { user: true },
    orderBy: { firstName: 'asc' },
  })

  const offerings = await db.professionalServiceOffering.findMany({
    where: { professionalId: user.professionalProfile.id, isActive: true },
    include: { service: { include: { category: true } } },
    orderBy: { service: { name: 'asc' } },
  })

  return (
    <main className="mx-auto w-full max-w-215 px-4 pb-24 pt-8">
      <a href="/pro" className="inline-block text-[12px] font-black text-textSecondary hover:text-textPrimary">
        ← Back to dashboard
      </a>

      <div className="mt-3">
        <h1 className="text-[22px] font-black text-textPrimary">New booking</h1>
        <p className="mt-1 text-[12px] text-textSecondary">
          Create a booking for a client. You can tweak times and services later.
        </p>
      </div>

      <div className="mt-5">
        <NewBookingForm clients={clients} offerings={offerings} defaultClientId={clientId} />
      </div>
    </main>
  )
}
