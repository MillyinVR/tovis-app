// app/(main)/booking/AvailabilityDrawer/components/WaitlistPanel.tsx
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import type { DrawerContext } from '../types'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'
import { isRecord, asTrimmedString, getRecordProp } from '@/lib/guards'

type WaitlistPreferenceType = 'ANY_TIME' | 'TIME_OF_DAY' | 'SPECIFIC_DATE'
type WaitlistTimeOfDay = 'MORNING' | 'AFTERNOON' | 'EVENING'

type WaitlistEntryDTO = {
  id: string
  status: string
  professionalId: string
  serviceId: string
  mediaId: string | null
  notes: string | null
  preferenceType: WaitlistPreferenceType
  specificDate: string | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
}

type SavedPrefs = {
  preferenceType: WaitlistPreferenceType
  specificDate: string
  timeOfDay: WaitlistTimeOfDay | null
  notes: string
}

const PREFS_KEY = 'tovis:waitlist:prefs:v2'

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return asTrimmedString(getRecordProp(raw, 'error'))
}

function parseNullableStringProp(obj: Record<string, unknown>, key: string): string | null | undefined {
  const raw = getRecordProp(obj, key)
  if (raw === null) return null
  if (raw === undefined) return undefined
  return asTrimmedString(raw)
}

function parseNullableNumberProp(obj: Record<string, unknown>, key: string): number | null | undefined {
  const raw = getRecordProp(obj, key)
  if (raw === null) return null
  if (raw === undefined) return undefined
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function parsePreferenceType(value: string | null): WaitlistPreferenceType | null {
  if (value === 'ANY_TIME' || value === 'TIME_OF_DAY' || value === 'SPECIFIC_DATE') return value
  return null
}

function parseTimeOfDay(value: string | null): WaitlistTimeOfDay | null {
  if (value === 'MORNING' || value === 'AFTERNOON' || value === 'EVENING') return value
  return null
}

function parseWaitlistOk(raw: unknown): { ok: true; entry: WaitlistEntryDTO } | null {
  if (!isRecord(raw) || getRecordProp(raw, 'ok') !== true) return null

  const entry = getRecordProp(raw, 'entry')
  if (!isRecord(entry)) return null

  const id = asTrimmedString(getRecordProp(entry, 'id'))
  const status = asTrimmedString(getRecordProp(entry, 'status'))
  const professionalId = asTrimmedString(getRecordProp(entry, 'professionalId'))
  const serviceId = asTrimmedString(getRecordProp(entry, 'serviceId'))

  const mediaId = parseNullableStringProp(entry, 'mediaId')
  const notes = parseNullableStringProp(entry, 'notes')
  const preferenceType = parsePreferenceType(asTrimmedString(getRecordProp(entry, 'preferenceType')))
  const specificDate = parseNullableStringProp(entry, 'specificDate')
  const timeOfDay = parseTimeOfDay(parseNullableStringProp(entry, 'timeOfDay') ?? null)
  const windowStartMin = parseNullableNumberProp(entry, 'windowStartMin')
  const windowEndMin = parseNullableNumberProp(entry, 'windowEndMin')

  if (!id || !status || !professionalId || !serviceId || !preferenceType) return null
  if (mediaId === undefined || notes === undefined || windowStartMin === undefined || windowEndMin === undefined) {
    return null
  }

  return {
    ok: true,
    entry: {
      id,
      status,
      professionalId,
      serviceId,
      mediaId,
      notes,
      preferenceType,
      specificDate: specificDate ?? null,
      timeOfDay,
      windowStartMin,
      windowEndMin,
    },
  }
}

function nowPartsInTz(timeZone: string) {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(d)
    .toLowerCase()

  if (!year || !month || !day) return null

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    weekday,
  }
}

function ymdToString(ymd: { year: number; month: number; day: number }): string {
  const month = String(ymd.month).padStart(2, '0')
  const day = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${month}-${day}`
}

function addDaysYmd(
  ymd: { year: number; month: number; day: number },
  daysToAdd: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + daysToAdd, 12, 0, 0, 0))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function weekdayIndex(shortLower: string): number {
  if (shortLower.startsWith('sun')) return 0
  if (shortLower.startsWith('mon')) return 1
  if (shortLower.startsWith('tue')) return 2
  if (shortLower.startsWith('wed')) return 3
  if (shortLower.startsWith('thu')) return 4
  if (shortLower.startsWith('fri')) return 5
  return 6
}

function computeQuickPick(
  kind: 'TONIGHT' | 'TOMORROW' | 'WEEKEND',
  appointmentTz: string,
): { preferenceType: WaitlistPreferenceType; specificDate: string; timeOfDay: WaitlistTimeOfDay | null } | null {
  const now = nowPartsInTz(appointmentTz)
  if (!now) return null

  if (kind === 'TONIGHT') {
    return {
      preferenceType: 'TIME_OF_DAY',
      specificDate: '',
      timeOfDay: 'EVENING',
    }
  }

  if (kind === 'TOMORROW') {
    const date = addDaysYmd(now, 1)
    return {
      preferenceType: 'SPECIFIC_DATE',
      specificDate: ymdToString(date),
      timeOfDay: null,
    }
  }

  const todayIdx = weekdayIndex(now.weekday)
  const saturdayIdx = 6
  const delta = ((saturdayIdx - todayIdx) + 7) % 7 || 7
  const date = addDaysYmd(now, delta)

  return {
    preferenceType: 'SPECIFIC_DATE',
    specificDate: ymdToString(date),
    timeOfDay: null,
  }
}

function loadPrefs(): SavedPrefs | null {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null

    const preferenceType = parsePreferenceType(asTrimmedString(getRecordProp(parsed, 'preferenceType'))) ?? 'ANY_TIME'
    const specificDate = asTrimmedString(getRecordProp(parsed, 'specificDate')) ?? ''
    const timeOfDay = parseTimeOfDay(asTrimmedString(getRecordProp(parsed, 'timeOfDay')))
    const notes = asTrimmedString(getRecordProp(parsed, 'notes')) ?? ''

    return {
      preferenceType,
      specificDate,
      timeOfDay,
      notes,
    }
  } catch {
    return null
  }
}

function savePrefs(prefs: SavedPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
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
  const [preferenceType, setPreferenceType] = React.useState<WaitlistPreferenceType>('ANY_TIME')
  const [specificDate, setSpecificDate] = React.useState('')
  const [timeOfDay, setTimeOfDay] = React.useState<WaitlistTimeOfDay | null>(null)
  const [notes, setNotes] = React.useState('')

  const [posting, setPosting] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState(false)

  React.useEffect(() => {
    if (!canWaitlist) return
    const prefs = loadPrefs()
    if (!prefs) return
    setPreferenceType(prefs.preferenceType)
    setSpecificDate(prefs.specificDate)
    setTimeOfDay(prefs.timeOfDay)
    setNotes(prefs.notes)
  }, [canWaitlist])

  React.useEffect(() => {
    if (!canWaitlist) return
    savePrefs({
      preferenceType,
      specificDate,
      timeOfDay,
      notes,
    })
  }, [canWaitlist, preferenceType, specificDate, timeOfDay, notes])

  if (!canWaitlist) return null

  const professionalId = (context.professionalId || '').trim() || null
  const serviceId = (effectiveServiceId || '').trim() || null

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
    setMsg(null)
    setOk(false)
  }

  function applyQuickPick(kind: 'TONIGHT' | 'TOMORROW' | 'WEEKEND') {
    const next = computeQuickPick(kind, appointmentTz)
    if (!next) return

    setPreferenceType(next.preferenceType)
    setSpecificDate(next.specificDate)
    setTimeOfDay(next.timeOfDay)
    setMsg(null)
    setOk(false)
  }

  async function submit() {
    if (!professionalId) {
      setOk(false)
      setMsg('Missing professional. Please close and try again.')
      return
    }

    if (!serviceId) {
      setOk(false)
      setMsg("This look is missing a service link, so a waitlist request can't be created yet.")
      return
    }

    if (posting) return

    if (preferenceType === 'SPECIFIC_DATE' && !specificDate) {
      setOk(false)
      setMsg('Please choose a date.')
      return
    }

    if (preferenceType === 'TIME_OF_DAY' && !timeOfDay) {
      setOk(false)
      setMsg('Please choose a time of day.')
      return
    }

    setPosting(true)
    setMsg(null)
    setOk(false)

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          professionalId,
          serviceId,
          mediaId: context.mediaId ?? null,
          notes: notes.trim() || null,
          preferenceType,
          specificDate: preferenceType === 'SPECIFIC_DATE' ? specificDate : null,
          timeOfDay: preferenceType === 'TIME_OF_DAY' ? timeOfDay : null,
          windowStartMin: null,
          windowEndMin: null,
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
      setMsg("You're on the waitlist. We'll notify you if something opens up.")
      resetFieldsButKeepPrefs()
      setOpen(false)
    } catch (e: unknown) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : 'Failed to join waitlist.')
    } finally {
      setPosting(false)
    }
  }

  const timeOfDayLabel =
    timeOfDay === 'MORNING'
      ? 'Morning'
      : timeOfDay === 'AFTERNOON'
        ? 'Afternoon'
        : timeOfDay === 'EVENING'
          ? 'Evening'
          : 'Any time'

  return (
    <div style={{ marginBottom: 16 }}>
      {msg ? (
        <div
          style={{
            marginBottom: 10,
            fontSize: 13,
            fontWeight: 600,
            color: ok ? '#4caf50' : '#FF3D4E',
          }}
        >
          {msg}
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={openForm}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 999,
            border: '1px solid rgba(244,239,231,0.1)',
            background: 'rgba(244,239,231,0.05)',
            fontSize: 13,
            fontWeight: 700,
            color: 'rgba(244,239,231,0.55)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
          }}
        >
          <span style={{ fontSize: 10, color: '#E05A28', lineHeight: 1 }}>✦</span>
          Nothing works? Join the waitlist
        </button>
      ) : (
        <div
          style={{
            borderRadius: 16,
            border: '1px solid rgba(244,239,231,0.12)',
            background: 'rgba(244,239,231,0.05)',
            padding: 16,
          }}
        >
        <div className="grid gap-3">
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
              Quick picks use <span className="font-black text-textPrimary">{appointmentTz}</span>.
            </div>
          </div>

          <label className="text-[12px] font-black text-textPrimary">
            Preference type
            <select
              value={preferenceType}
              onChange={(e) => {
                const value = parsePreferenceType(e.target.value)
                if (!value) return
                setPreferenceType(value)

                if (value !== 'SPECIFIC_DATE') setSpecificDate('')
                if (value !== 'TIME_OF_DAY') setTimeOfDay(null)
              }}
              disabled={posting}
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
            >
              <option value="ANY_TIME">Any time</option>
              <option value="TIME_OF_DAY">Time of day</option>
              <option value="SPECIFIC_DATE">Specific day</option>
            </select>
          </label>

          {preferenceType === 'TIME_OF_DAY' ? (
            <label className="text-[12px] font-black text-textPrimary">
              Time of day
              <select
                value={timeOfDay ?? ''}
                onChange={(e) => {
                  const value = parseTimeOfDay(e.target.value)
                  setTimeOfDay(value)
                }}
                disabled={posting}
                className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
              >
                <option value="">Choose one</option>
                <option value="MORNING">Morning</option>
                <option value="AFTERNOON">Afternoon</option>
                <option value="EVENING">Evening</option>
              </select>
              <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                Current preference: <span className="font-black text-textPrimary">{timeOfDayLabel}</span>
              </div>
            </label>
          ) : null}

          {preferenceType === 'SPECIFIC_DATE' ? (
            <label className="text-[12px] font-black text-textPrimary">
              Preferred day
              <input
                type="date"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
                disabled={posting}
                className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
              />
            </label>
          ) : null}

          <label className="text-[12px] font-black text-textPrimary">
            Notes (optional)
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={posting}
              placeholder="Ex: after work, weekends, short appointments preferred"
              className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70 disabled:opacity-70"
            />
            <div className="mt-1 text-[11px] font-semibold text-textSecondary">
              We'll remember your waitlist preference on this device.
            </div>
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
              onClick={closeForm}
              disabled={posting}
              className="h-11 rounded-full border border-white/10 bg-bgPrimary/35 text-[13px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  )
}