import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewBookingForm from './NewBookingForm'

export default async function NewBookingPage(props: {
  searchParams: Promise<{ clientId?: string }>
}) {
  const { clientId } = await props.searchParams

  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings/new')
  }

  const db: any = prisma

  const clients = await db.clientProfile.findMany({
    include: {
      user: true,
    },
    orderBy: {
      firstName: 'asc',
    },
  })

  const offerings = await db.professionalServiceOffering.findMany({
    where: {
      professionalId: user.professionalProfile.id,
      isActive: true,
    },
    include: {
      service: {
        include: {
          category: true,
        },
      },
    },
    orderBy: {
      service: {
        name: 'asc',
      },
    },
  })

  return (
    <main
      style={{
        maxWidth: 800,
        margin: '40px auto',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <a
        href="/pro"
        style={{
          fontSize: 12,
          color: '#555',
          marginBottom: 8,
          display: 'inline-block',
          textDecoration: 'none',
        }}
      >
        ← Back to dashboard
      </a>

      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>New booking</h1>
      <p style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
        Create a booking for a client. You can always tweak times and services later.
      </p>

      <NewBookingForm
        clients={clients}
        offerings={offerings}
        defaultClientId={clientId}
      />
    </main>
  )
}
