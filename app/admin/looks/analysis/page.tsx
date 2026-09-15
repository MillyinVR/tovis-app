import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'
import { getCurrentUser } from '@/lib/currentUser'
import LookAnalysisReview from '@/components/looks/LookAnalysisReview'

export const dynamic = 'force-dynamic'

export default async function AdminLookAnalysisPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')
  return <LookAnalysisReview mode="admin" />
}
