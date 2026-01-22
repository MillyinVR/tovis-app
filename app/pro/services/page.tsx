// app/pro/services/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import ServicePicker from './ServicePicker'
import OfferingManager from './OfferingManager'

export const dynamic = 'force-dynamic'

export default async function ProServicesPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/services')
  }

  const profId = user.professionalProfile.id

  const categories = await prisma.serviceCategory.findMany({
    where: { isActive: true, parentId: null },
    include: {
      children: {
        where: { isActive: true },
        include: {
          services: { where: { isActive: true }, orderBy: { name: 'asc' } },
        },
        orderBy: { name: 'asc' },
      },
      services: { where: { isActive: true }, orderBy: { name: 'asc' } },
    },
    orderBy: { name: 'asc' },
  })

  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: profId, isActive: true },
    include: {
      service: { include: { category: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const categoryPayload = categories.map((cat) => ({
    id: String(cat.id),
    name: cat.name,
    services: cat.services.map((s) => ({
      id: String(s.id),
      name: s.name,
      minPrice: moneyToString((s as any).minPrice) ?? '0.00',
      defaultDurationMinutes: s.defaultDurationMinutes ?? 60,
      defaultImageUrl: (s as any).defaultImageUrl ?? null,
    })),
    children: cat.children.map((child) => ({
      id: String(child.id),
      name: child.name,
      services: child.services.map((s) => ({
        id: String(s.id),
        name: s.name,
        minPrice: moneyToString((s as any).minPrice) ?? '0.00',
        defaultDurationMinutes: s.defaultDurationMinutes ?? 60,
        defaultImageUrl: (s as any).defaultImageUrl ?? null,
      })),
    })),
  }))

  const offeringsPayload = offerings.map((o) => ({
    id: String(o.id),
    serviceId: String(o.serviceId),

    title: null as string | null, // legacy typing support only
    description: o.description ?? null,
    customImageUrl: o.customImageUrl ?? null,

    offersInSalon: Boolean(o.offersInSalon),
    offersMobile: Boolean(o.offersMobile),

    salonPriceStartingAt: o.salonPriceStartingAt ? moneyToString(o.salonPriceStartingAt) : null,
    salonDurationMinutes: o.salonDurationMinutes ?? null,

    mobilePriceStartingAt: o.mobilePriceStartingAt ? moneyToString(o.mobilePriceStartingAt) : null,
    mobileDurationMinutes: o.mobileDurationMinutes ?? null,

    serviceName: o.service.name,
    categoryName: o.service.category?.name ?? null,
    serviceDefaultImageUrl: (o.service as any).defaultImageUrl ?? null,
    defaultImageUrl: (o.service as any).defaultImageUrl ?? null,

    minPrice: moneyToString((o.service as any).minPrice) ?? '0.00',
  }))

  return (
    <main className="mx-auto max-w-960px px-4 pb-28 pt-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-black text-textPrimary">My services</h1>
          <p className="mt-1 max-w-680px text-[13px] text-textSecondary">
            Pick from the TOVIS service library. Set pricing for Salon and/or Mobile. Service names stay consistent across
            the platform.
          </p>
        </div>

        <Link
          href="/pro"
          className="inline-flex w-fit items-center rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          ← Back to pro dashboard
        </Link>
      </header>

      <section className="tovis-glass mb-5 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3">
          <div className="text-[14px] font-black text-textPrimary">Add a service</div>
          <div className="mt-1 text-[12px] text-textSecondary">
            Choose from categories, then add it to your menu. Pricing is yours. Naming is not.
          </div>
        </div>

        <ServicePicker categories={categoryPayload} offerings={offeringsPayload} />
      </section>

      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3">
          <div className="text-[14px] font-black text-textPrimary">Your current offerings</div>
          <div className="mt-1 text-[12px] text-textSecondary">
            Upload a custom image per service if you want. It only affects how your services look in your menu.
          </div>
        </div>

        {offeringsPayload.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-3 text-[12px] text-textSecondary">
            You haven&apos;t added any services yet.
          </div>
        ) : (
          <OfferingManager initialOfferings={offeringsPayload} enforceCanonicalServiceNames enableServiceImageUpload />
        )}
      </section>
    </main>
  )
}
