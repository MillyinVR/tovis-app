import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/currentUser'
import { loadAuthorizedProLookBrief } from '@/lib/consult/proBrief'
import { ConsultWriteError } from '@/lib/consult/errors'
import { sanitizeTimeZone } from '@/lib/time'
import ProConsultBrief from '@/app/pro/_components/consult/ProConsultBrief'
export const dynamic = 'force-dynamic'
export default async function ProLookReview({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.professionalProfile || user.role !== 'PRO') redirect('/login')
  const { id } = await params
  let brief
  try { brief = await loadAuthorizedProLookBrief({ consultSessionId: id, professionalId: user.professionalProfile.id, actorUserId: user.id }) }
  catch (error) { if (error instanceof ConsultWriteError) notFound(); throw error }
  return <main className="mx-auto grid max-w-3xl gap-5 p-5">
    <Link href="/pro/consults" className="text-sm text-textSecondary underline">Look review queue</Link>
    <h1 className="text-xl font-bold text-textPrimary">Review this look</h1>
    <ProConsultBrief brief={brief} timeZone={sanitizeTimeZone(user.professionalProfile.timeZone)} />
  </main>
}
