// app/pro/services/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { getBrandConfig } from '@/lib/brand'
import ServicesManagerSection from '@/app/pro/profile/_sections/ServicesManagerSection'
import PrepChecklistEditor from '@/app/pro/services/PrepChecklistEditor'

export const dynamic = 'force-dynamic'

export default async function ProServicesPage() {
  const user = await getCurrentUser()
  const brand = getBrandConfig()

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
        subtitle={`Pick from the ${brand.displayName} service library. Set pricing for Salon and/or Mobile. Service names stay consistent across the platform.`}
      />

      {/* The pro's DEFAULT "Before you go" list — what every appointment shows
          unless that service has written its own (which lives per-service,
          inside Manage add-ons). Mounted here rather than per-service because
          it belongs to the pro, not to any one offering. */}
      <div className="mx-auto mt-4 w-full max-w-5xl px-4 pb-8">
        <PrepChecklistEditor />
      </div>
    </main>
  )
}
