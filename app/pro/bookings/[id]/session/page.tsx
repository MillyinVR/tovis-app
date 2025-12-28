// app/pro/bookings/[id]/session/page.tsx
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProBookingSessionRedirectPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params
  redirect(`/pro/bookings/${encodeURIComponent(id)}?step=session`)
}
