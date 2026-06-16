// app/client/bookings/[id]/consultation/page.tsx
//
// Deprecated route. Kept as a redirect to the canonical client booking page
// with `?step=consult` so saved links and notification deep-links continue to
// work. The canonical consultation surface lives on the client booking page
// itself, driven by `ConsultationApproval` + `ConsultationApprovalProof`.
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

  redirect(`/client/bookings/${encodeURIComponent(bookingId)}?step=consult`)
}
