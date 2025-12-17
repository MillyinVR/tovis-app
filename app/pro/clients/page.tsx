import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewClientForm from './NewClientForm'

export default async function ProClientsPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const db: any = prisma

  const clients = await db.clientProfile.findMany({
    include: {
      user: true,
      bookings: {
        orderBy: { scheduledFor: 'desc' },
        take: 1,
      },
    },
    orderBy: {
      firstName: 'asc',
    },
  })

  function formatLastSeen(c: any) {
    if (!c.bookings || c.bookings.length === 0) return 'No visits yet'
    const last = c.bookings[0]
    return `Last visit: ${new Date(last.scheduledFor).toLocaleDateString()}`
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>My clients</h1>
          <p style={{ fontSize: 14, color: '#555' }}>
            These are the clients you manage inside TOVIS. They can start as “shadow” clients
            before you ever give them app access.
          </p>
        </div>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Add a client</h2>
        <NewClientForm />
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Client list</h2>
        {clients.length === 0 ? (
          <p style={{ fontSize: 14, color: '#666' }}>
            No clients yet. Add your regulars so you can start attaching bookings and aftercare.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {clients.map((c: any) => (
              <div
                key={c.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 10,
                  padding: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  {/* Name links into the full client chart */}
                  <Link
                    href={`/pro/clients/${c.id}`}
                    style={{ fontWeight: 600, textDecoration: 'underline', color: '#111' }}
                  >
                    {c.firstName} {c.lastName}
                  </Link>
                  <div style={{ fontSize: 13, color: '#555' }}>{c.user?.email}</div>
                  {c.phone && (
                    <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
                      {c.phone}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                    {formatLastSeen(c)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12 }}>
                  <Link
                    href={`/pro/clients/${c.id}`}
                    style={{
                      fontSize: 12,
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid #ddd',
                      textDecoration: 'none',
                      color: '#111',
                      background: '#fafafa',
                    }}
                  >
                    View chart
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
