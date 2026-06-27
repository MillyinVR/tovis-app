// app/(main)/booking/AvailabilityDrawer/components/WaitlistPanel.tsx
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import type { DrawerContext } from '../types'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'
import { isRecord, asTrimmedString, getRecordProp } from '@/lib/guards'
import { getZonedParts, weekdayInTimeZone } from '@/lib/time'

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

type WaitlistFormState = {
  preferenceType: WaitlistPreferenceType
  specificDate: string
  timeOfDay: WaitlistTimeOfDay | null
  notes: string
}

type WaitlistStatus = {
  ok: boolean
  message: string | null
}

type QuickPickKind = 'TONIGHT' | 'TOMORROW' | 'WEEKEND'

const PREFS_KEY = 'tovis:waitlist:prefs:v2'

const DEFAULT_FORM_STATE: WaitlistFormState = {
  preferenceType: 'ANY_TIME',
  specificDate: '',
  timeOfDay: null,
  notes: '',
}

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return asTrimmedString(getRecordProp(raw, 'error'))
}

function parseNullableStringProp(
  obj: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const raw = getRecordProp(obj, key)
  if (raw === null) return null
  if (raw === undefined) return undefined
  return asTrimmedString(raw)
}

function parseNullableNumberProp(
  obj: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const raw = getRecordProp(obj, key)
  if (raw === null) return null
  if (raw === undefined) return undefined
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function parsePreferenceType(value: string | null): WaitlistPreferenceType | null {
  if (
    value === 'ANY_TIME' ||
    value === 'TIME_OF_DAY' ||
    value === 'SPECIFIC_DATE'
  ) {
    return value
  }

  return null
}

function parseTimeOfDay(value: string | null): WaitlistTimeOfDay | null {
  if (value === 'MORNING' || value === 'AFTERNOON' || value === 'EVENING') {
    return value
  }

  return null
}

function parseWaitlistOk(
  raw: unknown,
): { ok: true; entry: WaitlistEntryDTO } | null {
  if (!isRecord(raw) || getRecordProp(raw, 'ok') !== true) return null

  const entry = getRecordProp(raw, 'entry')
  if (!isRecord(entry)) return null

  const id = asTrimmedString(getRecordProp(entry, 'id'))
  const status = asTrimmedString(getRecordProp(entry, 'status'))
  const professionalId = asTrimmedString(getRecordProp(entry, 'professionalId'))
  const serviceId = asTrimmedString(getRecordProp(entry, 'serviceId'))

  const mediaId = parseNullableStringProp(entry, 'mediaId')
  const notes = parseNullableStringProp(entry, 'notes')
  const preferenceType = parsePreferenceType(
    asTrimmedString(getRecordProp(entry, 'preferenceType')),
  )
  const specificDate = parseNullableStringProp(entry, 'specificDate')
  const timeOfDay = parseTimeOfDay(
    parseNullableStringProp(entry, 'timeOfDay') ?? null,
  )
  const windowStartMin = parseNullableNumberProp(entry, 'windowStartMin')
  const windowEndMin = parseNullableNumberProp(entry, 'windowEndMin')

  if (!id || !status || !professionalId || !serviceId || !preferenceType) {
    return null
  }

  if (
    mediaId === undefined ||
    notes === undefined ||
    windowStartMin === undefined ||
    windowEndMin === undefined
  ) {
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

  const { year, month, day } = getZonedParts(d, timeZone)
  const weekday = weekdayInTimeZone(d, timeZone)

  if (!year || !month || !day) return null

  return {
    year,
    month,
    day,
    weekday,
  }
}

function ymdToString(ymd: {
  year: number
  month: number
  day: number
}): string {
  const month = String(ymd.month).padStart(2, '0')
  const day = String(ymd.day).padStart(2, '0')
  return `${ymd.year}-${month}-${day}`
}

function addDaysYmd(
  ymd: { year: number; month: number; day: number },
  daysToAdd: number,
): { year: number; month: number; day: number } {
  const d = new Date(
    Date.UTC(ymd.year, ymd.month - 1, ymd.day + daysToAdd, 12, 0, 0, 0),
  )

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function computeQuickPick(
  kind: QuickPickKind,
  appointmentTz: string,
): Pick<WaitlistFormState, 'preferenceType' | 'specificDate' | 'timeOfDay'> | null {
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

  const todayIdx = now.weekday
  const saturdayIdx = 6
  const delta = ((saturdayIdx - todayIdx) + 7) % 7 || 7
  const date = addDaysYmd(now, delta)

  return {
    preferenceType: 'SPECIFIC_DATE',
    specificDate: ymdToString(date),
    timeOfDay: null,
  }
}

function readPrefsFromStorage(): SavedPrefs | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null

    const preferenceType =
      parsePreferenceType(
        asTrimmedString(getRecordProp(parsed, 'preferenceType')),
      ) ?? 'ANY_TIME'

    const specificDate =
      asTrimmedString(getRecordProp(parsed, 'specificDate')) ?? ''

    const timeOfDay = parseTimeOfDay(
      asTrimmedString(getRecordProp(parsed, 'timeOfDay')),
    )

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

function initialFormState(): WaitlistFormState {
  return readPrefsFromStorage() ?? DEFAULT_FORM_STATE
}

function savePrefs(prefs: SavedPrefs): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Best-effort preference persistence only.
  }
}

function timeOfDayLabel(timeOfDay: WaitlistTimeOfDay | null): string {
  if (timeOfDay === 'MORNING') return 'Morning'
  if (timeOfDay === 'AFTERNOON') return 'Afternoon'
  if (timeOfDay === 'EVENING') return 'Evening'
  return 'Any time'
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
  const [form, setForm] = React.useState<WaitlistFormState>(initialFormState)
  const [posting, setPosting] = React.useState(false)
  const [status, setStatus] = React.useState<WaitlistStatus>({
    ok: false,
    message: null,
  })

  const professionalId = (context.professionalId || '').trim() || null
  const serviceId = (effectiveServiceId || '').trim() || null

  const helperText = noPrimarySlots
    ? 'No matching openings right now. Waitlist requests help the pro know you want in.'
    : 'Join the waitlist if none of the visible times work for you.'

  function updateForm(patch: Partial<WaitlistFormState>): void {
    setForm((current) => {
      const next = { ...current, ...patch }

      savePrefs({
        preferenceType: next.preferenceType,
        specificDate: next.specificDate,
        timeOfDay: next.timeOfDay,
        notes: next.notes,
      })

      return next
    })
  }

  function setMessage(ok: boolean, message: string | null): void {
    setStatus({ ok, message })
  }

  function openForm(): void {
    setMessage(false, null)
    setOpen(true)
  }

  function closeForm(): void {
    if (posting) return
    setOpen(false)
    setMessage(false, null)
  }

  function applyQuickPick(kind: QuickPickKind): void {
    const next = computeQuickPick(kind, appointmentTz)
    if (!next) return

    updateForm(next)
    setMessage(false, null)
  }

  async function submit(): Promise<void> {
    if (!professionalId) {
      setMessage(false, 'Missing professional. Please close and try again.')
      return
    }

    if (!serviceId) {
      setMessage(
        false,
        "This look is missing a service link, so a waitlist request can't be created yet.",
      )
      return
    }

    if (posting) return

    if (form.preferenceType === 'SPECIFIC_DATE' && !form.specificDate) {
      setMessage(false, 'Please choose a date.')
      return
    }

    if (form.preferenceType === 'TIME_OF_DAY' && !form.timeOfDay) {
      setMessage(false, 'Please choose a time of day.')
      return
    }

    setPosting(true)
    setMessage(false, null)

    try {
      const res = await fetch('/api/v1/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          professionalId,
          serviceId,
          mediaId: context.mediaId ?? null,
          notes: form.notes.trim() || null,
          preferenceType: form.preferenceType,
          specificDate:
            form.preferenceType === 'SPECIFIC_DATE' ? form.specificDate : null,
          timeOfDay:
            form.preferenceType === 'TIME_OF_DAY' ? form.timeOfDay : null,
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
          throw new Error(
            pickApiError(raw) ??
              'You already have an active waitlist request for this pro/service.',
          )
        }

        throw new Error(pickApiError(raw) ?? `Waitlist failed (${res.status}).`)
      }

      const parsed = parseWaitlistOk(raw)
      if (!parsed) throw new Error('Waitlist failed (unexpected response).')

      setMessage(true, "You're on the waitlist. We'll notify you if something opens up.")
      setOpen(false)
    } catch (e: unknown) {
      setMessage(false, e instanceof Error ? e.message : 'Failed to join waitlist.')
    } finally {
      setPosting(false)
    }
  }

  if (!canWaitlist) return null

  return (
    <div className="mb-4">
      {status.message ? (
        <div
          className={[
            'mb-2 text-[13px] font-semibold',
            status.ok ? 'text-toneSuccess' : 'text-toneDanger',
          ].join(' ')}
        >
          {status.message}
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={openForm}
          className={[
            'flex h-11 w-full items-center justify-center gap-2 rounded-full',
            'border border-white/10 bg-white/5',
            'text-[13px] font-bold text-textSecondary',
            'transition hover:bg-white/10 hover:text-textPrimary',
          ].join(' ')}
        >
          <span className="text-[10px] leading-none text-accentPrimary">✦</span>
          Nothing works? Join the waitlist
        </button>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <div className="text-[12px] font-black text-textPrimary">
                Quick picks
              </div>

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
                Quick picks use{' '}
                <span className="font-black text-textPrimary">
                  {appointmentTz}
                </span>
                .
              </div>

              <div className="text-[11px] font-semibold text-textSecondary">
                {helperText}
              </div>
            </div>

            <label className="text-[12px] font-black text-textPrimary">
              Preference type
              <select
                value={form.preferenceType}
                onChange={(e) => {
                  const value = parsePreferenceType(e.target.value)
                  if (!value) return

                  updateForm({
                    preferenceType: value,
                    specificDate:
                      value === 'SPECIFIC_DATE' ? form.specificDate : '',
                    timeOfDay: value === 'TIME_OF_DAY' ? form.timeOfDay : null,
                  })

                  setMessage(false, null)
                }}
                disabled={posting}
                className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
              >
                <option value="ANY_TIME">Any time</option>
                <option value="TIME_OF_DAY">Time of day</option>
                <option value="SPECIFIC_DATE">Specific day</option>
              </select>
            </label>

            {form.preferenceType === 'TIME_OF_DAY' ? (
              <label className="text-[12px] font-black text-textPrimary">
                Time of day
                <select
                  value={form.timeOfDay ?? ''}
                  onChange={(e) => {
                    updateForm({ timeOfDay: parseTimeOfDay(e.target.value) })
                    setMessage(false, null)
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
                  Current preference:{' '}
                  <span className="font-black text-textPrimary">
                    {timeOfDayLabel(form.timeOfDay)}
                  </span>
                </div>
              </label>
            ) : null}

            {form.preferenceType === 'SPECIFIC_DATE' ? (
              <label className="text-[12px] font-black text-textPrimary">
                Preferred day
                <input
                  type="date"
                  value={form.specificDate}
                  onChange={(e) => {
                    updateForm({ specificDate: e.target.value })
                    setMessage(false, null)
                  }}
                  disabled={posting}
                  className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none disabled:opacity-70"
                />
              </label>
            ) : null}

            <label className="text-[12px] font-black text-textPrimary">
              Notes optional
              <input
                value={form.notes}
                onChange={(e) => {
                  updateForm({ notes: e.target.value })
                  setMessage(false, null)
                }}
                disabled={posting}
                placeholder="Ex: after work, weekends, short bookings preferred"
                className="mt-2 h-11 w-full rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70 disabled:opacity-70"
              />

              <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                We&apos;ll remember your waitlist preference on this device.
              </div>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={posting}
                className={[
                  'h-11 rounded-full border border-white/10 text-[13px] font-black transition',
                  posting
                    ? 'cursor-not-allowed bg-bgPrimary/20 text-textPrimary/70'
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