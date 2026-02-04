// app/pro/profile/_sections/ServicesManagerSection.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'

import OfferingManager from '@/app/pro/services/OfferingManager'
import ServicesManagerSectionClient from './ServicesManagerSectionClient'

export const dynamic = 'force-dynamic'

type Props = {
  backHref?: string
  backLabel?: string
  title?: string | null
  subtitle?: string | null
  variant?: 'page' | 'section'
}

export default async function ServicesManagerSection({
  backHref,
  backLabel = '← Back',
  title = 'My services',
  subtitle = `Pick from the TOVIS service library. Set pricing for Salon and/or Mobile. Service names stay consistent across the platform.`,
  variant = 'section',
}: Props) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login')
  }

  const profId = user.professionalProfile.id

  const categories = await prisma.serviceCategory.findMany({
    where: { isActive: true, parentId: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      services: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          minPrice: true,
          defaultDurationMinutes: true,
          defaultImageUrl: true,
          isAddOnEligible: true,
          addOnGroup: true,
        },
      },
      children: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          services: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              minPrice: true,
              defaultDurationMinutes: true,
              defaultImageUrl: true,
              isAddOnEligible: true,
              addOnGroup: true,
            },
          },
        },
      },
    },
  })

  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: profId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      serviceId: true,
      description: true,
      customImageUrl: true,

      offersInSalon: true,
      offersMobile: true,

      salonPriceStartingAt: true,
      salonDurationMinutes: true,

      mobilePriceStartingAt: true,
      mobileDurationMinutes: true,

      service: {
        select: {
          id: true,
          name: true,
          isActive: true,
          minPrice: true,
          defaultImageUrl: true,
          isAddOnEligible: true,
          addOnGroup: true,
          category: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
        },
      },
    },
  })

  const categoryPayload = categories.map((cat) => ({
    id: String(cat.id),
    name: cat.name,
    services: cat.services.map((s) => ({
      id: String(s.id),
      name: s.name,
      minPrice: moneyToString(s.minPrice) ?? '0.00',
      defaultDurationMinutes: s.defaultDurationMinutes ?? 60,
      defaultImageUrl: s.defaultImageUrl ?? null,
      isAddOnEligible: Boolean(s.isAddOnEligible),
      addOnGroup: s.addOnGroup ?? null,
    })),
    children: cat.children.map((child) => ({
      id: String(child.id),
      name: child.name,
      services: child.services.map((s) => ({
        id: String(s.id),
        name: s.name,
        minPrice: moneyToString(s.minPrice) ?? '0.00',
        defaultDurationMinutes: s.defaultDurationMinutes ?? 60,
        defaultImageUrl: s.defaultImageUrl ?? null,
        isAddOnEligible: Boolean(s.isAddOnEligible),
        addOnGroup: s.addOnGroup ?? null,
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
    defaultImageUrl: o.service.defaultImageUrl ?? null,

    minPrice: moneyToString(o.service.minPrice) ?? '0.00',

    serviceIsAddOnEligible: Boolean(o.service.isAddOnEligible),
    serviceAddOnGroup: o.service.addOnGroup ?? null,

    // ✅ Option 1 (standardized names)
    isServiceActive: Boolean(o.service.isActive),
    isCategoryActive: Boolean(o.service.category?.isActive ?? false),
  }))

  const outer = variant === 'page' ? 'mx-auto max-w-960px px-4 pb-28 pt-6' : 'mx-auto max-w-5xl pt-4'

  return (
    <section className={outer}>
      {(title || backHref || subtitle) && (
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title ? <h1 className="text-[22px] font-black text-textPrimary">{title}</h1> : null}
            {subtitle ? <p className="mt-1 max-w-680px text-[13px] text-textSecondary">{subtitle}</p> : null}
          </div>

          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex w-fit items-center rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
            >
              {backLabel}
            </Link>
          ) : null}
        </header>
      )}

      {/* ✅ Client controller: reads ?add=1 and opens overlay */}
      <ServicesManagerSectionClient categories={categoryPayload} offerings={offeringsPayload} />

      {/* Offerings manager */}
      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3">
          <div className="text-[14px] font-black text-textPrimary">Your current offerings</div>
          <div className="mt-1 text-[12px] text-textSecondary">
            Edit pricing, durations, add-ons, and your custom service image (only your menu).
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
    </section>
  )
}
