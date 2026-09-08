import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { loadProLookReviewQueue } from '@/lib/consult/lookReviewQueue'
import { formatInTimeZone, sanitizeTimeZone } from '@/lib/time'
export const dynamic = 'force-dynamic'
export default async function ProLookQueue({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const user = await getCurrentUser()
  if (!user?.professionalProfile || user.role !== 'PRO') redirect('/login')
  const queue = await loadProLookReviewQueue(user.professionalProfile.id, (await searchParams).cursor)
  const timeZone = sanitizeTimeZone(user.professionalProfile.timeZone)
  return <main className="mx-auto grid max-w-3xl gap-4 p-5 text-textPrimary">
    <h1 className="text-xl font-bold">Look plans to review</h1>
    <p className="text-sm text-textSecondary">Review the client’s direction, adjust the plan, and confirm the same version before the appointment.</p>
    {!queue.items.length && <p>No look plans to review yet.</p>}
    {queue.items.map(item => <article key={item.consultId} className="grid gap-2 rounded-xl border border-surfaceGlass/10 bg-bgSurface p-4">
      <h2 className="font-semibold">{item.clientName} · Version {item.version}</h2>
      {item.scheduledFor && <p className="text-sm">{formatInTimeZone(new Date(item.scheduledFor), timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
      {item.appointmentStatus && <p className="text-xs text-textSecondary">{item.appointmentStatus === 'COMPLETED' ? 'Completed visit · saved brief' : item.appointmentStatus === 'IN_PROGRESS' ? 'Appointment in progress' : item.appointmentStatus === 'CANCELLED' || item.appointmentStatus === 'NO_SHOW' ? 'Appointment no longer active' : 'Upcoming appointment'}</p>}
      <p className="text-sm">{item.awaitingAnalysis ? 'Client updated the details — plan needs review.' : item.professionalConfirmed ? 'You confirmed this version.' : 'Your review is needed.'}</p>
      <p className="text-xs text-textSecondary">{item.clientConfirmed ? 'Client confirmed.' : 'Client confirmation pending.'}</p>
      {item.changes.map((change, index) => <p key={index} className="text-sm text-textSecondary">{change}</p>)}
      <Link className="justify-self-start underline" href={`/pro/consults/${encodeURIComponent(item.consultId)}`}>Review look</Link>
      {item.bookingId && <Link className="justify-self-start text-sm underline" href={`/pro/bookings/${encodeURIComponent(item.bookingId)}`}>View appointment</Link>}
    </article>)}
    {queue.nextCursor && <Link href={`/pro/consults?cursor=${encodeURIComponent(queue.nextCursor)}`}>More look plans</Link>}
  </main>
}
