// app/pro/reminders/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function formatDateTime(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function ProRemindersPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/reminders')
  }

  const db: any = prisma

  const [reminders, clients] = await Promise.all([
    db.reminder.findMany({
      where: {
        professionalId: user.professionalProfile.id,
      },
      include: {
        client: true,
        booking: {
          include: {
            service: true,
          },
        },
      },
      orderBy: {
        dueAt: 'asc',
      },
    }),
    db.clientProfile.findMany({
      include: {
        user: true,
      },
      orderBy: {
        firstName: 'asc',
      },
    }),
  ])

  const openReminders = reminders.filter((r: any) => !r.completedAt)
  const completedReminders = reminders
    .filter((r: any) => r.completedAt)
    .sort(
      (a: any, b: any) =>
        +new Date(b.completedAt) - +new Date(a.completedAt),
    )
    .slice(0, 20)

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '40px auto',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <header
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
            Reminders
          </h1>
          <p style={{ fontSize: 13, color: '#555' }}>
            Use this for follow-ups, rebooks, product check-ins, and anything else
            Future You will forget.
          </p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#777' }}>
          <div>{user.professionalProfile.businessName || 'Your business'}</div>
          <div>{user.professionalProfile.location}</div>
          <div style={{ marginTop: 8 }}>
            <a
              href="/pro"
              style={{
                fontSize: 12,
                textDecoration: 'none',
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
              }}
            >
              ← Back to pro dashboard
            </a>
          </div>
        </div>
      </header>

      {/* CREATE REMINDER */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Add a reminder
        </h2>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
          Example: “Check in on color fade”, “DM bridal party count”, “Follow up
          on retail purchase”.
        </p>

        <form
          method="post"
          action="/api/pro/reminders"
          style={{
            borderRadius: 12,
            border: '1px solid #eee',
            padding: 16,
            background: '#fff',
            display: 'grid',
            gap: 10,
          }}
        >
          <div>
            <label
              htmlFor="title"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              Title *
            </label>
            <input
              id="title"
              name="title"
              required
              placeholder="Follow up with client"
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #ddd',
                padding: 8,
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="body"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              Notes (optional)
            </label>
            <textarea
              id="body"
              name="body"
              rows={3}
              placeholder="E.g. ask how her scalp handled last lightening, remind about purple shampoo."
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #ddd',
                padding: 8,
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
              gap: 10,
            }}
          >
            <div>
              <label
                htmlFor="dueAt"
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                Due date & time *
              </label>
              <input
                id="dueAt"
                name="dueAt"
                type="datetime-local"
                required
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                Uses your browser&apos;s local timezone.
              </div>
            </div>

            <div>
              <label
                htmlFor="clientId"
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                Linked client (optional)
              </label>
              <select
                id="clientId"
                name="clientId"
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              >
                <option value="">No specific client</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                    {c.user?.email ? ` • ${c.user.email}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* For now, keep type fixed to GENERAL. Later we can expose a dropdown. */}
          <input type="hidden" name="type" value="GENERAL" />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="submit"
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                border: 'none',
                fontSize: 13,
                background: '#111',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Save reminder
            </button>
          </div>
        </form>
      </section>

      {/* OPEN REMINDERS */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Upcoming & open reminders
        </h2>
        {openReminders.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            Nothing on your radar yet. Future you is suspicious.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {openReminders.map((r: any) => (
              <div
                key={r.id}
                style={{
                  borderRadius: 10,
                  border: '1px solid #eee',
                  padding: 10,
                  background: '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>
                    {formatDateTime(r.dueAt)}
                  </div>

                  {r.client && (
                    <div style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>
                      Client:{' '}
                      <a
                        href={`/pro/clients/${r.client.id}`}
                        style={{ color: '#111', textDecoration: 'underline' }}
                      >
                        {r.client.firstName} {r.client.lastName}
                      </a>
                    </div>
                  )}

                  {r.booking && (
                    <div style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>
                      Booking: {r.booking.service?.name || 'Service'} on{' '}
                      {formatDateTime(r.booking.scheduledFor)}
                    </div>
                  )}

                  {r.body && (
                    <div style={{ fontSize: 12, color: '#444', marginTop: 4 }}>
                      {r.body}
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right', fontSize: 11, minWidth: 120 }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: '1px solid #ddd',
                      marginBottom: 6,
                      textTransform: 'lowercase',
                    }}
                  >
                    {r.type.toLowerCase()}
                  </div>

                  <form
                    method="post"
                    action={`/api/pro/reminders/${r.id}/complete`}
                  >
                    <button
                      type="submit"
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: '1px solid #10b981',
                        background: '#ecfdf5',
                        color: '#047857',
                        cursor: 'pointer',
                      }}
                    >
                      Mark done
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* RECENTLY COMPLETED */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Recently completed
        </h2>
        {completedReminders.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            Once you start completing reminders, they&apos;ll show up here for a bit.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {completedReminders.map((r: any) => (
              <div
                key={r.id}
                style={{
                  borderRadius: 8,
                  border: '1px solid #f0f0f0',
                  padding: 8,
                  background: '#fafafa',
                  fontSize: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <div style={{ color: '#666', marginTop: 2 }}>
                    Due {formatDateTime(r.dueAt)}
                  </div>
                  {r.completedAt && (
                    <div style={{ color: '#999', marginTop: 2 }}>
                      Completed {formatDateTime(r.completedAt)}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#999', textAlign: 'right' }}>
                  {r.client && (
                    <div>
                      {r.client.firstName} {r.client.lastName}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
