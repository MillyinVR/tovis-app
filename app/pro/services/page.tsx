// app/pro/services/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import ServicesManagerSection from '@/app/pro/profile/_sections/ServicesManagerSection'

export const dynamic = 'force-dynamic'

export default async function ProServicesPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/services')
  }

  return (
    <main>
      <ServicesManagerSection
        variant="page"
        backHref="/pro/dashboard"
        backLabel="← Back to pro dashboard"
        title="My services"
        subtitle="Pick from the TOVIS service library. Set pricing for Salon and/or Mobile. Service names stay consistent across the platform."
      />
    </main>
  )
}
