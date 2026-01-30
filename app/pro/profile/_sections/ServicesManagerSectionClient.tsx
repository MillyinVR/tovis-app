// app/pro/profile/_sections/ServicesManagerSectionClient.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
}

export default function ServicesManagerSectionClient(props: { categories: CategoryDTO[]; offerings: OfferingDTO[] }) {
  const { categories, offerings } = props
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  const isOpenFromUrl = (searchParams?.get('add') || '') === '1'
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(isOpenFromUrl)
  }, [isOpenFromUrl])

  const openOverlay = () => {
    const sp = new URLSearchParams(searchParams?.toString())
    sp.set('add', '1')
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  const closeOverlay = () => {
    const sp = new URLSearchParams(searchParams?.toString())
    sp.delete('add')
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  return (
    <>
      {/* Luxe “Add service” trigger (replaces the big inline picker section) */}
      <section className="tovis-glass mb-5 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-black text-textPrimary">Add a service</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Choose from the library. Your pricing. Platform-consistent names.
            </div>
          </div>

          <button
            type="button"
            onClick={openOverlay}
            className="rounded-full border border-white/12 bg-bgPrimary/40 px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/22 active:scale-[0.98] transition"
          >
            + Add
          </button>
        </div>
      </section>

      <AddServiceOverlay open={open} onClose={closeOverlay} categories={categories} offerings={offerings} />
    </>
  )
}
