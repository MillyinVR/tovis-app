// app/client/bookings/[id]/AftercareRebookButton.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer'
import { COPY } from '@/lib/copy'

import type { DrawerContext } from '@/app/(main)/booking/AvailabilityDrawer/types'

type Props = {
  /**
   * Pro + service to rebook. `source` is forced to AFTERCARE so the new
   * booking is attributed to the aftercare rebook entry point.
   */
  professionalId: string
  serviceId: string | null
  /**
   * Optional ISO date to anchor the drawer's initial window to (the pro's
   * recommended rebook window start, or a proposed next-appointment date). When
   * present and in the future, the drawer opens on that date instead of today.
   */
  anchorStartIso?: string | null
  /** Pro/appointment timezone, used to resolve the anchor to a YMD. */
  timeZone: string
  /** Button label. Defaults to "Rebook now". */
  label?: string
}

function ymdInTimeZone(date: Date, timeZone: string): string {
  // en-CA renders YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export default function AftercareRebookButton({
  professionalId,
  serviceId,
  anchorStartIso,
  timeZone,
  label,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const initialStartDate = useMemo(() => {
    if (!anchorStartIso) return null
    const start = new Date(anchorStartIso)
    if (Number.isNaN(start.getTime())) return null

    const startYmd = ymdInTimeZone(start, timeZone)
    const todayYmd = ymdInTimeZone(new Date(), timeZone)
    // Never anchor to a past date; fall back to today's window.
    return startYmd > todayYmd ? startYmd : null
  }, [anchorStartIso, timeZone])

  const context: DrawerContext = useMemo(
    () => ({
      professionalId,
      serviceId,
      offeringId: null,
      mediaId: null,
      source: 'AFTERCARE',
      initialStartDate,
    }),
    [professionalId, serviceId, initialStartDate],
  )

  const close = useCallback(() => {
    setOpen(false)
    // A successful booking inside the drawer leaves the page stale; refresh so
    // the new appointment shows up if the client returns to their bookings.
    router.refresh()
  }, [router])

  return (
    <>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="brand-button-primary brand-focus inline-flex items-center gap-1 rounded-full px-4 py-2 text-[12px]"
        >
          {label ?? COPY.bookings.aftercare.rebookCtaNow} <span aria-hidden>→</span>
        </button>
      </div>

      <AvailabilityDrawer open={open} onClose={close} context={context} />
    </>
  )
}
