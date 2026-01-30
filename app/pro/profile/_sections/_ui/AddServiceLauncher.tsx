'use client'

import { useState } from 'react'
import AddServiceOverlay from '../AddServiceOverlay'

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

export default function AddServiceLauncher(props: {
  categories: CategoryDTO[]
  offerings: OfferingDTO[]
}) {
  const { categories, offerings } = props
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          'inline-flex items-center justify-center rounded-full px-4 py-2 text-[12px] font-black transition active:scale-[0.98]',
          'border border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
          'shadow-[0_18px_50px_rgb(0_0_0/0.40)]',
        ].join(' ')}
      >
        + Add a service
      </button>

      <AddServiceOverlay
        open={open}
        onClose={() => setOpen(false)}
        categories={categories}
        offerings={offerings}
      />
    </>
  )
}
