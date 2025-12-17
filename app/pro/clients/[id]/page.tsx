import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewNoteForm from './NewNoteForm'
import NewAllergyForm from './NewAllergyForm'
import EditAlertBannerForm from './EditAlertBannerForm'
import { moneyToString } from '@/lib/money'

function formatDate(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function ClientDetailPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params

  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const db: any = prisma

  // Pull client + related chart data
  const client = await db.clientProfile.findUnique({
    where: { id },
    include: {
      user: true,
      bookings: {
        include: {
          service: {
            include: { category: true },
          },
          professional: true,
          aftercareSummary: true,
        },
        orderBy: { scheduledFor: 'desc' },
      },
      allergies: {
        include: {
          recordedBy: {
            include: { user: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      notes: {
        where: {
          professionalId: user.professionalProfile.id,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!client) {
    redirect('/pro/clients')
  }

  // Product recommendations across all their bookings
  const productRecs = await db.productRecommendation.findMany({
    where: {
      aftercareSummary: {
        booking: {
          clientId: client.id,
        },
      },
    },
    include: {
      product: true,
      aftercareSummary: {
        include: {
          booking: true,
        },
      },
    },
  })

  // Reviews this client left *for this pro*
  const reviews = await db.review.findMany({
    where: {
      clientId: client.id,
      professionalId: user.professionalProfile.id,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Basic stats
  const totalVisits = client.bookings.length
  const lastVisit = client.bookings[0] ?? null
  const upcoming = client.bookings
    .filter((b: any) => new Date(b.scheduledFor) > new Date())
    .sort((a: any, b: any) => +new Date(a.scheduledFor) - +new Date(b.scheduledFor))[0] ?? null

  return (
    <main
      style={{
        maxWidth: 980,
        margin: '40px auto',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      {/* Breadcrumb / header */}
      <a
        href="/pro/clients"
        style={{
          fontSize: 12,
          color: '#555',
          marginBottom: 8,
          display: 'inline-block',
          textDecoration: 'none',
        }}
      >
        ← Back to clients
      </a>

      {/* OVERVIEW */}
      <header
  style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 16,
  }}
>
  <div>
    <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
      {client.firstName} {client.lastName}
    </h1>
    <div style={{ fontSize: 13, color: '#555' }}>
      {client.user?.email || 'No email on file'}
      {client.phone ? ` • ${client.phone}` : ''}
    </div>

    {client.alertBanner && (
      <div
        style={{
          marginTop: 10,
          display: 'inline-flex',
          padding: '4px 10px',
          borderRadius: 999,
          background: '#fff4e5',
          border: '1px solid #f0b46a',
          fontSize: 12,
          color: '#8a4a00',
        }}
      >
        ⚠ {client.alertBanner}
      </div>
    )}
  </div>

  <div style={{ textAlign: 'right', fontSize: 12, color: '#555' }}>
    <div>Total visits: {totalVisits}</div>
    {lastVisit && (
      <div>Last visit: {formatDate(lastVisit.scheduledFor)}</div>
    )}
    {upcoming && (
      <div style={{ marginTop: 4 }}>
        Next visit:{' '}
        <span style={{ fontWeight: 600 }}>
          {formatDate(upcoming.scheduledFor)}
        </span>
      </div>
      
    )}

    {/* New booking button */}
    <div style={{ marginTop: 8 }}>
      <a
        href={`/pro/bookings/new?clientId=${client.id}`}
        style={{
          display: 'inline-block',
          padding: '6px 12px',
          borderRadius: 999,
          border: '1px solid #111',
          fontSize: 12,
          textDecoration: 'none',
          color: '#fff',
          background: '#111',
        }}
      >
        New booking for this client
      </a>
    </div>
          <div style={{ marginTop: 8 }}>
            <EditAlertBannerForm
              clientId={client.id}
              initialAlertBanner={client.alertBanner ?? null}
            />
          </div>
  </div>
</header>


      {/* "Tabs" nav (anchors) */}
      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 24,
          fontSize: 13,
        }}
      >
        {[
          { id: 'notes', label: 'Notes' },
          { id: 'allergies', label: 'Allergies' },
          { id: 'history', label: 'Service history' },
          { id: 'products', label: 'Products' },
          { id: 'reviews', label: 'Reviews' },
        ].map((tab) => (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #ddd',
              textDecoration: 'none',
              color: '#111',
              background: '#fafafa',
            }}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      {/* NOTES SECTION */}
      <section id="notes" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Pro notes</h2>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Private notes visible to you (and admins). Good for personality details,
          preferences, or behavior patterns.
        </p>

        <div style={{ marginBottom: 16 }}>
          <NewNoteForm clientId={client.id} />
        </div>

        {client.notes.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            No notes yet. Start the gossip file in a professional way.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {client.notes.map((note: any) => (
              <div
                key={note.id}
                style={{
                  borderRadius: 10,
                  border: '1px solid #eee',
                  padding: 10,
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {note.title || 'Note'}
                  </div>
                  <div style={{ fontSize: 11, color: '#999' }}>
                    {formatDate(note.createdAt)}
                  </div>
                </div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {note.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ALLERGIES SECTION */}
      <section id="allergies" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Allergies & sensitivities</h2>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Anything that could cause a reaction or needs extra care. This is your
          “do not fry their scalp” section.
        </p>

        <div style={{ marginBottom: 16 }}>
          <NewAllergyForm clientId={client.id} />
        </div>

        {client.allergies.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            No allergies recorded yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {client.allergies.map((a: any) => (
              <div
                key={a.id}
                style={{
                  borderRadius: 10,
                  border: '1px solid #eee',
                  padding: 10,
                  background: '#fff',
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{a.label}</div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: '1px solid #ddd',
                    }}
                  >
                    {a.severity}
                  </span>
                </div>
                {a.description && (
                  <div style={{ color: '#555', marginBottom: 4 }}>
                    {a.description}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#999' }}>
                  Recorded {formatDate(a.createdAt)}
                  {a.recordedBy?.user?.email
                    ? ` • by ${a.recordedBy.user.email}`
                    : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SERVICE HISTORY */}
      <section id="history" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Service history</h2>
        {client.bookings.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>No bookings yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {client.bookings.map((b: any) => (
              <div
                key={b.id}
                style={{
                  borderRadius: 10,
                  border: '1px solid #eee',
                  padding: 10,
                  background: '#fff',
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {b.service.name}
                    </div>
                    {b.service.category && (
                      <div style={{ fontSize: 12, color: '#777' }}>
                        {b.service.category.name}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: '#555' }}>
                    <div>{formatDate(b.scheduledFor)}</div>
                    <div>
                      {Math.round(b.durationMinutesSnapshot)} min • $
                      {moneyToString(b.priceSnapshot) ?? '0.00'}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      Status: {b.status}
                    </div>
                  </div>
                </div>
                {b.aftercareSummary && (
                  <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                    <span style={{ fontWeight: 600 }}>Aftercare:</span>{' '}
                    {b.aftercareSummary.notes
                      ? `${b.aftercareSummary.notes.slice(0, 120)}${
                          b.aftercareSummary.notes.length > 120 ? '…' : ''
                        }`
                      : 'No notes'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* PRODUCTS */}
      <section id="products" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Products recommended</h2>
        {productRecs.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            No product recommendations recorded yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {productRecs
              .sort(
                (a: any, b: any) =>
                  +new Date(b.aftercareSummary.booking.scheduledFor) -
                  +new Date(a.aftercareSummary.booking.scheduledFor),
              )
              .map((r: any) => (
                <div
                  key={r.id}
                  style={{
                    borderRadius: 10,
                    border: '1px solid #eee',
                    padding: 10,
                    background: '#fff',
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.product.name}</div>
                      {r.product.brand && (
                        <div style={{ fontSize: 12, color: '#777' }}>
                          {r.product.brand}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#555', textAlign: 'right' }}>
                      {formatDate(r.aftercareSummary.booking.scheduledFor)}
                    </div>
                  </div>
                  {r.note && (
                    <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                      {r.note}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </section>

      {/* REVIEWS */}
      <section id="reviews" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Reviews from this client</h2>
        {reviews.length === 0 ? (
          <p style={{ fontSize: 13, color: '#777' }}>
            This client hasn&apos;t left you any reviews yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {reviews.map((rev: any) => (
              <div
                key={rev.id}
                style={{
                  borderRadius: 10,
                  border: '1px solid #eee',
                  padding: 10,
                  background: '#fff',
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {rev.headline || 'Review'}
                    </div>
                    <div style={{ fontSize: 12, color: '#777' }}>
                      Rating: {rev.rating}/5
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#999' }}>
                    {formatDate(rev.createdAt)}
                  </div>
                </div>
                {rev.body && (
                  <div style={{ fontSize: 13, color: '#555' }}>
                    {rev.body}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
