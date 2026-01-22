// app/(main)/booking/AvailabilityDrawer/components/WaitlistPanel.tsx

'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import type { DrawerContext } from '../types'
import { toISOFromDatetimeLocalInTimeZone } from '@/lib/bookingTime'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'

export default function WaitlistPanel({
  canWaitlist,
  appointmentTz,
  context,
  effectiveServiceId,
  noPrimarySlots,
}: {
  canWaitlist: boolean
  appointmentTz: string
  context: DrawerContext
  effectiveServiceId: string | null
  noPrimarySlots: boolean
}) {
  const router = useRouter()

  const [open, setOpen] = React.useState(false)
  const [desired, setDesired] = React.useState('')
  const [flexMinutes, setFlexMinutes] = React.useState(60)
  const [notes, setNotes] = React.useState('')
  const [posting, setPosting] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState(false)

  if (!canWaitlist) return null

  async function submit() {
    if (!context) return

    if (!effectiveServiceId) {
      setOk(false)
      setMsg('This look is missing a service link, so waitlist can’t be created yet.')
      return
    }
    if (posting) return

    setPosting(true)
    setMsg(null)
    setOk(false)

    try {
      const desiredISO = desired ? toISOFromDatetimeLocalInTimeZone(desired, appointmentTz) : null

      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professionalId: context.professionalId,
          serviceId: effectiveServiceId,
          mediaId: context.mediaId,
          desiredFor: desiredISO,
          flexibilityMinutes: flexMinutes,
          notes: notes?.trim() || null,
        }),
      })

      const body = await safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'waitlist')
        return
      }

      if (!res.ok) throw new Error(body?.error || `Waitlist failed (${res.status}).`)

      setOk(true)
      setMsg('You’re on the waitlist. We’ll notify you if something opens up.')
      setOpen(false)
    } catch (e: any) {
      setOk(false)
      setMsg(e?.message || 'Failed to join waitlist.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-black text-textPrimary">Waitlist</div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            {noPrimarySlots ? 'Get notified when something opens.' : 'Can’t make these times? We’ll ping you.'}
          </div>
        </div>
      </div>

      {msg ? (
        <div className={['mt-3 text-[13px] font-semibold', ok ? 'text-toneSuccess' : 'text-toneDanger'].join(' ')}>
          {msg}
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 text-[13px] font-black text-textPrimary hover:bg-white/10"
        >
          Join waitlist
        </button>
      ) : (
        <div className="mt-3 grid gap-3">
          <label className="text-[12px] font-black text-textPrimary">
            Preferred date/time (optional)
            <input
              type="datetime-local"
              value={desired}
              onChange={(e) => setDesired(e.target.value)}
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none"
            />
          </label>

          <label className="text-[12px] font-black text-textPrimary">
            Flexibility
            <select
              value={flexMinutes}
              onChange={(e) => setFlexMinutes(Number(e.target.value))}
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none"
            >
              <option value={30}>± 30 minutes</option>
              <option value={60}>± 1 hour</option>
              <option value={120}>± 2 hours</option>
              <option value={240}>± 4 hours</option>
            </select>
          </label>

          <label className="text-[12px] font-black text-textPrimary">
            Notes (optional)
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: after 5pm, weekends, prefer shorter appointment"
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={posting}
              className={[
                'h-11 rounded-full border border-white/10 text-[13px] font-black transition',
                posting
                  ? 'bg-bgPrimary/20 text-textPrimary/70 cursor-not-allowed'
                  : 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              ].join(' ')}
            >
              {posting ? 'Joining…' : 'Confirm'}
            </button>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-11 rounded-full border border-white/10 bg-bgPrimary/35 text-[13px] font-black text-textPrimary hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
