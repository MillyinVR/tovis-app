import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import LookAnalysisReview from '@/components/looks/LookAnalysisReview'

export const dynamic = 'force-dynamic'

export default async function ProLookAnalysisPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== 'PRO' || !user.professionalProfile) redirect('/forbidden')
  // The /pro layout also enforces verified sessions and onboarding readiness.
  return <LookAnalysisReview mode="pro" />
}
