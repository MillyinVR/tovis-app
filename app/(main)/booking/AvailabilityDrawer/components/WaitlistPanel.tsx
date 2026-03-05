// app/(main)/booking/AvailabilityDrawer/components/WaitlistPanel.tsx
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import type { DrawerContext } from '../types'
import { toISOFromDatetimeLocalInTimeZone } from '@/lib/bookingTime'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'
import { isRecord, asTrimmedString, getRecordProp } from '@/lib/guards'

type TimeBucket = 'MORNING' | 'AFTERNOON' | 'EVENING' | null

type WaitlistEntryDTO = {
  id: string
  status: string
  professionalId: string
  serviceId: string
  mediaId: string | null
  preferredStart: string
  preferredEnd: string
  preferredTimeBucket: string | null
}

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return asTrimmedString(getRecordProp(raw, 'error'))
}

function parseWaitlistOk(raw: unknown): { ok: true; entry: WaitlistEntryDTO } | null {
  if (!isRecord(raw) || getRecordProp(raw, 'ok') !== true) return null

  const entry = getRecordProp(raw, 'entry')
  if (!isRecord(entry)) return null

  const id = asTrimmedString(getRecordProp(entry, 'id'))
  const status = asTrimmedString(getRecordProp(entry, 'status'))
  const professionalId = asTrimmedString(getRecordProp(entry, 'professionalId'))
  const serviceId = asTrimmedString(getRecordProp(entry, 'serviceId'))
  const preferredStart = asTrimmedString(getRecordProp(entry, 'preferredStart'))
  const preferredEnd = asTrimmedString(getRecordProp(entry, 'preferredEnd'))

  const mediaIdRaw = getRecordProp(entry, 'mediaId')
  const mediaId = mediaIdRaw === null ? null : asTrimmedString(mediaIdRaw)
  if (mediaIdRaw !== null && mediaId == null) return null

  const bucketRaw = getRecordProp(entry, 'preferredTimeBucket')
  const preferredTimeBucket = bucketRaw === null ? null : asTrimmedString(bucketRaw)
  if (bucketRaw !== null && preferredTimeBucket == null) return null

  if (!id || !status || !professionalId || !serviceId || !preferredStart || !preferredEnd) return null

  return {
    ok: true,
    entry: { id, status, professionalId, serviceId, mediaId, preferredStart, preferredEnd, preferredTimeBucket },
  }
}

function toFlexMinutes(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  const x = Number.isFinite(n) ? Math.trunc(n) : fallback
  const allowed = new Set([30, 60, 120, 240])
  return allowed.has(x) ? x : fallback
}

/**
 * Convert "now" to YYYY-MM-DD + weekday in a given timeZone.
 * We intentionally avoid Date math in local tz.
 */
function nowPartsInTz(timeZone: string) {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d).toLowerCase()

  if (!y || !m || !day) return null
  return { year: Number(y), month: Number(m), day: Number(day), weekday: w }
}

function ymdToString(ymd: { year: number; month: number; day: number }) {
  const mm = String(ymd.month).padStart(2, '0')
  const dd = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${mm}-${dd}`
}

function addDaysYmd(ymd: { year: number; month: number; day: number }, daysToAdd: number) {
  // anchor at noon UTC so DST boundaries don’t bite the date math
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/**
 * Build datetime-local string "YYYY-MM-DDTHH:MM" (interpreted later in appointmentTz).
 */
function buildDatetimeLocal(ymd: { year: number; month: number; day: number }, hh: number, mm: number) {
  const date = ymdToString(ymd)
  const H = String(Math.min(23, Math.max(0, Math.trunc(hh)))).padStart(2, '0')
  const M = String(Math.min(59, Math.max(0, Math.trunc(mm)))).padStart(2, '0')
  return `${date}T${H}:${M}`
}

function weekdayIndex(shortLower: string) {
  // sun..sat
  if (shortLower.startsWith('sun')) return 0
  if (shortLower.startsWith('mon')) return 1
  if (shortLower.startsWith('tue')) return 2
  if (shortLower.startsWith('wed')) return 3
  if (shortLower.startsWith('thu')) return 4
  if (shortLower.startsWith('fri')) return 5
  return 6
}

function computeQuickPick(kind: 'TONIGHT' | 'TOMORROW' | 'WEEKEND', appointmentTz: string): string | null {
  const now = nowPartsInTz(appointmentTz)
  if (!now) return null

  // choose sane defaults
  // tonight: 6:00pm local to appointmentTz
  // tomorrow: 10:00am
  // weekend: next Saturday 10:00am
  if (kind === 'TOMORROW') {
    const d = addDaysYmd(now, 1)
    return buildDatetimeLocal(d, 10, 0)
  }

  if (kind === 'WEEKEND') {
    const todayIdx = weekdayIndex(now.weekday)
    const satIdx = 6
    const delta = ((satIdx - todayIdx) + 7) % 7 || 7 // if today is sat, go to next sat
    const d = addDaysYmd(now, delta)
    return buildDatetimeLocal(d, 10, 0)
  }

  // TONIGHT
  // if it’s already “late” in the appointment tz, bump to tomorrow night.
  // We approximate “late” by checking current hour in appointment tz.
  const hourParts = new Intl.DateTimeFormat('en-US', {
    timeZone: appointmentTz,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const hh = Number(hourParts.find((p) => p.type === 'hour')?.value ?? '0')
  const isLate = Number.isFinite(hh) ? hh >= 18 : false

  const base = isLate ? addDaysYmd(now, 1) : { year: now.year, month: now.month, day: now.day }
  return buildDatetimeLocal(base, 18, 0)
}

const PREFS_KEY = 'tovis:waitlist:prefs:v1'

type SavedPrefs = {
  flexMinutes: number
  notes: string
  preferredTimeBucket: TimeBucket
}

function loadPrefs(): SavedPrefs | null {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedPrefs>
    const flex = toFlexMinutes(parsed.flexMinutes, 60)
    const notes = typeof parsed.notes === 'string' ? parsed.notes : ''
    const b = parsed.preferredTimeBucket
    const preferredTimeBucket: TimeBucket =
      b === 'MORNING' || b === 'AFTERNOON' || b === 'EVENING' ? b : null
    return { flexMinutes: flex, notes, preferredTimeBucket }
  } catch {
    return null
  }
}

function savePrefs(p: SavedPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // ignore
  }
}

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
  const [desired, setDesired] = React.useState('') // datetime-local string
  const [flexMinutes, setFlexMinutes] = React.useState(60)
  const [notes, setNotes] = React.useState('')
  const [preferredTimeBucket, setPreferredTimeBucket] = React.useState<TimeBucket>(null)

  const [posting, setPosting] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState(false)

  if (!canWaitlist) return null

  const professionalId = (context.professionalId || '').trim() || null
  const serviceId = (effectiveServiceId || '').trim() || null

  // Load saved prefs once
  React.useEffect(() => {
    const p = loadPrefs()
    if (!p) return
    setFlexMinutes(p.flexMinutes)
    setNotes(p.notes)
    setPreferredTimeBucket(p.preferredTimeBucket)
  }, [])

  // Persist prefs whenever they change (cheap + reliable)
  React.useEffect(() => {
    savePrefs({ flexMinutes, notes, preferredTimeBucket })
  }, [flexMinutes, notes, preferredTimeBucket])

  function openForm() {
    setMsg(null)
    setOk(false)
    setOpen(true)
  }

  function closeForm() {
    if (posting) return
    setOpen(false)
    setMsg(null)
    setOk(false)
  }

  function resetFieldsButKeepPrefs() {
    setDesired('')
    // keep flexMinutes/notes/bucket (these are “remember my prefs”)
  }

  function applyQuickPick(kind: 'TONIGHT' | 'TOMORROW' | 'WEEKEND') {
    const v = computeQuickPick(kind, appointmentTz)
    if (v) {
      setDesired(v)
      setMsg(null)
      setOk(false)
    }
  }

  async function submit() {
    if (!professionalId) {
      setOk(false)
      setMsg('Missing professional. Please close and try again.')
      return
    }
    if (!serviceId) {
      setOk(false)
      setMsg('This look is missing a service link, so a waitlist request can’t be created yet.')
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
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          professionalId,
          serviceId,
          mediaId: context.mediaId ?? null,

          desiredFor: desiredISO,
          preferredTimeBucket: preferredTimeBucket, // ✅ new (server can ignore safely)
          flexibilityMinutes: flexMinutes,
          notes: notes.trim() || null,
        }),
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'waitlist')
        return
      }

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(pickApiError(raw) ?? 'You already have an active waitlist request for this pro/service.')
        }
        throw new Error(pickApiError(raw) ?? `Waitlist failed (${res.status}).`)
      }

      const parsed = parseWaitlistOk(raw)
      if (!parsed) throw new Error('Waitlist failed (unexpected response).')

      setOk(true)
      setMsg('You’re on the waitlist. We’ll notify you if something opens up.')
      resetFieldsButKeepPrefs()
      setOpen(false)
    } catch (e: unknown) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : 'Failed to join waitlist.')
    } finally {
      setPosting(false)
    }
  }

  const bucketLabel =
    preferredTimeBucket === 'MORNING'
      ? 'Morning'
      : preferredTimeBucket === 'AFTERNOON'
        ? 'Afternoon'
        : preferredTimeBucket === 'EVENING'
          ? 'Evening'
          : 'Any time'

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
          onClick={openForm}
          className="mt-3 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 text-[13px] font-black text-textPrimary hover:bg-white/10"
        >
          Join waitlist
        </button>
      ) : (
        <div className="mt-3 grid gap-3">
          {/* Quick picks */}
          <div className="grid gap-2">
            <div className="text-[12px] font-black text-textPrimary">Quick picks</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => applyQuickPick('TONIGHT')}
                disabled={posting}
                className="h-10 rounded-full border border-white/10 bg-bgPrimary/35 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
              >
                Tonight
              </button>
              <button
                type="button"
                onClick={() => applyQuickPick('TOMORROW')}
                disabled={posting}
                className="h-10 rounded-full border border-white/10 bg-bgPrimary/35 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => applyQuickPick('WEEKEND')}
                disabled={posting}
                className="h-10 rounded-full border border-white/10 bg-bgPrimary/35 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
              >
                This weekend
              </button>
            </div>
            <div className="text-[11px] font-semibold text-textSecondary">
              These set a suggested time in <span className="font-black text-textPrimary">{appointmentTz}</span>.
            </div>
          </div>

          {/* Desired datetime */}
          <label className="text-[12px] font-black text-textPrimary">
            Preferred date/time (optional)
            <input
              type="datetime-local"
              value={desired}
              onChange={(e) => setDesired(e.target.value)}
              disabled={posting}
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
            />
          </label>

          {/* Time bucket */}
          <label className="text-[12px] font-black text-textPrimary">
            Time window
            <select
              value={preferredTimeBucket ?? ''}
              onChange={(e) => {
                const v = e.target.value
                const next: TimeBucket = v === 'MORNING' || v === 'AFTERNOON' || v === 'EVENING' ? v : null
                setPreferredTimeBucket(next)
              }}
              disabled={posting}
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
            >
              <option value="">Any time</option>
              <option value="MORNING">Morning</option>
              <option value="AFTERNOON">Afternoon</option>
              <option value="EVENING">Evening</option>
            </select>
            <div className="mt-1 text-[11px] font-semibold text-textSecondary">
              Current preference: <span className="font-black text-textPrimary">{bucketLabel}</span> (saved on this device)
            </div>
          </label>

          {/* Flex */}
          <label className="text-[12px] font-black text-textPrimary">
            Flexibility
            <select
              value={flexMinutes}
              onChange={(e) => setFlexMinutes(toFlexMinutes(e.target.value, 60))}
              disabled={posting}
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
            >
              <option value={30}>± 30 minutes</option>
              <option value={60}>± 1 hour</option>
              <option value={120}>± 2 hours</option>
              <option value={240}>± 4 hours</option>
            </select>
          </label>

          {/* Notes */}
          <label className="text-[12px] font-black text-textPrimary">
            Notes (optional)
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={posting}
              placeholder="Ex: after 5pm, weekends, prefer shorter appointment"
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70 disabled:opacity-70"
            />
            <div className="mt-1 text-[11px] font-semibold text-textSecondary">
              Notes + flexibility + time window are remembered automatically.
            </div>
          </label>

          {/* Actions */}
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
              onClick={closeForm}
              disabled={posting}
              className="h-11 rounded-full border border-white/10 bg-bgPrimary/35 text-[13px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}