// app/professionals/[id]/ServicesBookingOverlay.tsx
'use client'

import * as React from 'react'
import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer'
import type { DrawerContext } from '@/app/(main)/booking/AvailabilityDrawer/types'

type UiOffering = {
  id: string
  serviceId: string
  name: string
  description: string | null
  imageUrl: string | null
  pricingLines: string[]
}

export default function ServicesBookingOverlay({
  professionalId,
  offerings,
}: {
  professionalId: string
  offerings: UiOffering[]
}) {
  const [open, setOpen] = React.useState(false)
  const [ctx, setCtx] = React.useState<DrawerContext | null>(null)

  function openForService(serviceId: string) {
    const next: DrawerContext = {
      professionalId,
      serviceId,
      mediaId: null,
      source: 'REQUESTED',
    }
    setCtx(next)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setCtx(null)
  }

  return (
    <>
      <div className="tovis-glass grid gap-2 rounded-card border border-white/10 bg-bgSecondary p-3">
        {offerings.map((off) => (
          <button
            key={off.id}
            type="button"
            onClick={() => openForService(off.serviceId)}
            className="flex w-full items-start justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary p-3 text-left text-textPrimary hover:border-white/20"
            title="Book this service"
          >
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="h-13 w-13 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-bgSecondary">
                {off.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={off.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="truncate text-[13px] font-black">{off.name}</div>

                {off.description ? (
                  <div className="mt-1 text-[12px] font-semibold text-textSecondary">{off.description}</div>
                ) : null}

                {off.pricingLines.length ? (
                  <div className="mt-2 grid gap-1 text-[12px] font-semibold">
                    {off.pricingLines.map((line) => (
                      <div key={line} className="text-textSecondary">
                        {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary opacity-80">Pricing not set</div>
                )}
              </div>
            </div>

            <div className="grid justify-items-end gap-2">
              <div className="rounded-full bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary">
                Book
              </div>
              <div className="text-[12px] font-semibold text-textSecondary">→</div>
            </div>
          </button>
        ))}
      </div>

      {ctx ? <AvailabilityDrawer open={open} onClose={close} context={ctx} /> : null}
    </>
  )
}
