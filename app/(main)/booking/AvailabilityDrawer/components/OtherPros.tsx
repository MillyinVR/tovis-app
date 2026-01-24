// app/(main)/booking/AvailabilityDrawer/components/OtherPros.tsx

'use client'

import Link from 'next/link'
import type { ProCard, SelectedHold } from '../types'
import { formatSlotLabel, formatSlotFullLabel } from '@/lib/bookingTime'

export default function OtherPros({
  others,
  effectiveServiceId,
  viewerTz,
  appointmentTz,
  holding,
  selected,
  onPick,
  setRef,
}: {
  others: ProCard[]
  effectiveServiceId: string | null
  viewerTz: string | null
  appointmentTz: string
  holding: boolean
  selected: SelectedHold | null
  onPick: (proId: string, offeringId: string | null, slotISO: string) => void
  setRef: (el: HTMLDivElement | null) => void
}) {
  if (!effectiveServiceId) return null

  return (
    <div ref={setRef} className="tovis-glass-soft rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">Other pros near you</div>

      {others.length ? (
        <div className="mt-3 grid gap-3">
          {others.map((p) => {
            const pTz = p.timeZone || appointmentTz
            const showPtzHint = Boolean(viewerTz && viewerTz !== pTz)

            return (
              <div key={p.id} className="rounded-card border border-white/10 bg-bgPrimary/25 p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 overflow-hidden rounded-full bg-white/10">
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/professionals/${p.id}`}
                      className="block truncate text-[13px] font-black text-textPrimary"
                    >
                      {p.businessName || 'Professional'}
                    </Link>

                    {p.location ? (
                      <div className="truncate text-[12px] font-semibold text-textSecondary">{p.location}</div>
                    ) : null}

                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      Times in <span className="font-black text-textPrimary">{pTz}</span>
                      {showPtzHint ? <span> · You: {viewerTz}</span> : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(p.slots || []).slice(0, 4).map((iso) => {
                    const isSelected = selected?.proId === p.id && selected?.slotISO === iso
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => onPick(p.id, p.offeringId, iso)}
                        disabled={!p.offeringId || holding}
                        className={[
                          'h-10 rounded-full border px-3 text-[13px] font-black transition',
                          'border-white/10',
                          isSelected
                            ? 'bg-accentPrimary text-bgPrimary'
                            : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                          !p.offeringId || holding ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                        ].join(' ')}
                        title={formatSlotFullLabel(iso, pTz)}
                      >
                        {formatSlotLabel(iso, pTz)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-2 text-[13px] font-semibold text-textSecondary">No similar pros found yet.</div>
      )}
    </div>
  )
}
