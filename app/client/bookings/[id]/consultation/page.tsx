// app/client/bookings/[id]/consultation/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export default async function ClientConsultationLegacyPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}?step=consult`)}`)
  }

  // Canonical location for consultation decisions:
  redirect(`/client/bookings/${encodeURIComponent(bookingId)}?step=consult`)
}
