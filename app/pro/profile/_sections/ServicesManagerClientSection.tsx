'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import OfferingManager from '@/app/pro/services/OfferingManager'
import AddServiceOverlay from './AddServiceOverlay'

type ServiceDTO = {
  id: string
  name: string
  minPrice: string
  defaultDurationMinutes: number
  defaultImageUrl?: string | null
  isAddOnEligible: boolean
  addOnGroup?: string | null
}

type CategoryDTO = {
  id: string
  name: string
  services: ServiceDTO[]
  children: { id: string; name: string; services: ServiceDTO[] }[]
}

type OfferingDTO = {
  id: string
  serviceId: string

  title: string | null
  description: string | null

  customImageUrl: string | null
  serviceDefaultImageUrl?: string | null
  defaultImageUrl?: string | null

  serviceName: string
  categoryName: string | null

  minPrice: string

  serviceIsAddOnEligible?: boolean
  serviceAddOnGroup?: string | null

  offersInSalon: boolean
  offersMobile: boolean

  salonPriceStartingAt: string | null
  salonDurationMinutes: number | null

  mobilePriceStartingAt: string | null
  mobileDurationMinutes: number | null
}

export default function ServicesManagerClientSection({
  variant,
  backHref,
  backLabel,
  title,
  subtitle,
  categories,
  offerings,
}: {
  variant: 'page' | 'section'
  backHref?: string
  backLabel?: string
  title?: string | null
  subtitle?: string | null
  categories: CategoryDTO[]
  offerings: OfferingDTO[]
}) {
  const [open, setOpen] = useState(false)

  const outer = variant === 'page' ? 'mx-auto max-w-960px px-4 pb-28 pt-6' : 'mx-auto max-w-5xl pt-2'

  const hasOfferings = useMemo(() => (offerings?.length ?? 0) > 0, [offerings])

  return (
    <section className={outer}>
      {(title || backHref || subtitle) && (
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title ? <h1 className="text-[22px] font-black text-textPrimary">{title}</h1> : null}
            {subtitle ? <p className="mt-1 max-w-680px text-[13px] text-textSecondary">{subtitle}</p> : null}
          </div>

          <div className="flex items-center gap-2">
            {backHref ? (
              <Link
                href={backHref}
                className="inline-flex w-fit items-center rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
              >
                {backLabel}
              </Link>
            ) : null}

            <button
              type="button"
              onClick={() => setOpen(true)}
              className={[
                'rounded-full px-4 py-2 text-[12px] font-black transition active:scale-[0.98]',
                'border border-accentPrimary/55 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                'shadow-[0_18px_48px_rgb(0_0_0/0.40)]',
              ].join(' ')}
            >
              + Add service
            </button>
          </div>
        </header>
      )}

      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[14px] font-black text-textPrimary">Your current offerings</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Edit pricing, duration, add-ons, and your custom service image (only your menu).
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-white/10 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 hover:bg-bgPrimary/80"
          >
            Add
          </button>
        </div>

        {!hasOfferings ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-3 text-[12px] text-textSecondary">
            You haven&apos;t added any services yet.
          </div>
        ) : (
          <OfferingManager initialOfferings={offerings} enforceCanonicalServiceNames enableServiceImageUpload />
        )}
      </section>

      <AddServiceOverlay open={open} onClose={() => setOpen(false)} categories={categories} offerings={offerings} />
    </section>
  )
}
