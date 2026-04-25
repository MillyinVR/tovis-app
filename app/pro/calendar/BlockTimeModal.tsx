// app/pro/calendar/BlockTimeModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { safeJson } from '@/lib/http'
import { parseHHMM } from '@/lib/scheduling/workingHours'

import {
  normalizeStepMinutes,
  roundDurationMinutes,
  snapMinutes,
} from './_utils/calendarMath'

export type BlockRow = {
  id: string
  startsAt: string
  endsAt: string
  note: string | null
  locationId?: string | null
}

type BlockTimeModalProps = {
  open: boolean
  onClose: () => void
  initialStart: Date
  timeZone: string
  locationId: string | null
  locationLabel?: string | null
  stepMinutes?: number
  onCreated: (block: BlockRow) => void
}

type DateParts = {
  year: number
  month: number
  day: number
}

type CreatedBlockPayload = {
  startsAt: string
  endsAt: string
  note: string | null
  locationId: string | null
}

const DEFAULT_BLOCK_DURATION_MINUTES = 60
const MAX_NOTE_LENGTH = 160

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function dateInputFromParts(parts: DateParts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function timeInputFromMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${pad2(hour)}:${pad2(minute)}`
}

function parseDateInput(value: string): DateParts | null {
  const parts = value.split('-')
  if (parts.length !== 3) return null

  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  return { year, month, day }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredString(value: unknown, errorMessage: string) {
  const stringValue = optionalString(value)
  if (!stringValue) throw new Error(errorMessage)
  return stringValue
}

function errorFromResponse(data: unknown, fallback: string) {
  if (!isRecord(data)) return fallback
  return optionalString(data.error) ?? optionalString(data.message) ?? fallback
}

function parseCreatedBlock(data: unknown): BlockRow {
  if (!isRecord(data) || !isRecord(data.block)) {
    throw new Error('Block created but response was missing data.')
  }

  const block = data.block

  return {
    id: requiredString(block.id, 'Block created but response was missing an id.'),
    startsAt: requiredString(
      block.startsAt,
      'Block created but response was missing a start time.',
    ),
    endsAt: requiredString(
      block.endsAt,
      'Block created but response was missing an end time.',
    ),
    note: optionalString(block.note),
    locationId: optionalString(block.locationId),
  }
}

function buildPayload(args: {
  date: string
  time: string
  durationInput: string
  note: string
  timeZone: string
  stepMinutes: number
  blockAllLocations: boolean
  locationId: string | null
}): CreatedBlockPayload {
  const parsedDate = parseDateInput(args.date)
  if (!parsedDate) throw new Error('Pick a valid date.')

  const parsedTime = parseHHMM(args.time)
  if (!parsedTime) throw new Error('Pick a valid start time.')

  const rawDuration = Number(args.durationInput)
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    throw new Error('Pick a valid duration.')
  }

  const durationMinutes = roundDurationMinutes(rawDuration, args.stepMinutes)

  if (!args.blockAllLocations && !args.locationId) {
    throw new Error('Select a location first, or choose “Block all locations”.')
  }

  const startsAt = zonedTimeToUtc({
    year: parsedDate.year,
    month: parsedDate.month,
    day: parsedDate.day,
    hour: parsedTime.hh,
    minute: parsedTime.mm,
    second: 0,
    timeZone: args.timeZone,
  })

  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error('Invalid start time.')
  }

  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000)

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error('End time must be after start time.')
  }

  const trimmedNote = args.note.trim()

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    note: trimmedNote ? trimmedNote : null,
    locationId: args.blockAllLocations ? null : args.locationId,
  }
}

function buttonClassName(tone: 'primary' | 'ghost' = 'ghost') {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-transparent text-[var(--paper-mute)] hover:bg-[var(--paper)]/[0.05] hover:text-[var(--paper)]',
  ].join(' ')
}

function fieldClassName() {
  return [
    'w-full rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2',
    'text-sm font-semibold text-[var(--paper)]',
    'placeholder:text-[var(--paper-mute)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
}

function checkboxClassName() {
  return 'h-4 w-4 rounded border-[var(--line)] bg-[var(--ink-2)]'
}

function lockBodyScroll(open: boolean) {
  if (!open) return

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

function closeOnEscape(args: {
  open: boolean
  saving: boolean
  onClose: () => void
}) {
  const { open, saving, onClose } = args

  if (!open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !saving) {
      onClose()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

export default function BlockTimeModal(props: BlockTimeModalProps) {
  const {
    open,
    onClose,
    initialStart,
    timeZone,
    locationId,
    locationLabel,
    stepMinutes,
    onCreated,
  } = props

  const resolvedTimeZone = useMemo(
    () => sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE),
    [timeZone],
  )

  const step = useMemo(
    () => normalizeStepMinutes(stepMinutes),
    [stepMinutes],
  )

  const initialInputs = useMemo(() => {
    const parts = getZonedParts(initialStart, resolvedTimeZone)
    const rawStartMinutes = parts.hour * 60 + parts.minute
    const snappedStartMinutes = snapMinutes(rawStartMinutes, step)

    return {
      date: dateInputFromParts({
        year: parts.year,
        month: parts.month,
        day: parts.day,
      }),
      time: timeInputFromMinutes(snappedStartMinutes),
    }
  }, [initialStart, resolvedTimeZone, step])

  const [date, setDate] = useState(initialInputs.date)
  const [time, setTime] = useState(initialInputs.time)
  const [durationInput, setDurationInput] = useState(
    String(DEFAULT_BLOCK_DURATION_MINUTES),
  )
  const [note, setNote] = useState('')
  const [blockAllLocations, setBlockAllLocations] = useState(locationId === null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => lockBodyScroll(open), [open])

  useEffect(
    () =>
      closeOnEscape({
        open,
        saving,
        onClose,
      }),
    [open, saving, onClose],
  )

  useEffect(() => {
    if (!open) return

    setError(null)
    setSaving(false)
    setDate(initialInputs.date)
    setTime(initialInputs.time)
    setDurationInput(String(DEFAULT_BLOCK_DURATION_MINUTES))
    setNote('')
    setBlockAllLocations(locationId === null)
  }, [initialInputs.date, initialInputs.time, locationId, open])

  function close() {
    if (saving) return
    setError(null)
    onClose()
  }

  async function submit() {
    if (saving) return

    setSaving(true)
    setError(null)

    try {
      const payload = buildPayload({
        date,
        time,
        durationInput,
        note,
        timeZone: resolvedTimeZone,
        stepMinutes: step,
        blockAllLocations,
        locationId,
      })

      const response = await fetch('/api/pro/calendar/blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(errorFromResponse(data, 'Failed to create block.'))
      }

      const createdBlock = parseCreatedBlock(data)
      onCreated(createdBlock)
      onClose()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Failed to create block.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-[var(--ink)]',
          'shadow-[0_28px_90px_rgb(0_0_0/0.62)]',
          'sm:max-w-[34rem] sm:rounded-[24px]',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-time-modal-title"
      >
        <header className="border-b border-[var(--line-strong)] bg-[var(--ink)]/92 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--paper)]/20 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--terra-glow)]">
                ◆ Calendar block
              </p>

              <h2
                id="block-time-modal-title"
                className="mt-1 font-display text-3xl font-semibold italic tracking-[-0.05em] text-[var(--paper)]"
              >
                Block personal time.
              </h2>

              <p className="mt-1 text-sm leading-6 text-[var(--paper-dim)]">
                Protect breaks, admin time, travel, or a full-on human reset.
                Revolutionary concept.
              </p>
            </div>

            <button
              type="button"
              onClick={close}
              disabled={saving}
              className={buttonClassName('ghost')}
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {error ? <StateCard danger>{error}</StateCard> : null}

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.03] p-4">
            <SectionHeading
              title="Scope"
              description="Choose whether this block applies to the selected location or every location."
            />

            <div className="mt-4 grid gap-3">
              <InfoRow label="Location">
                {blockAllLocations
                  ? 'All locations'
                  : locationLabel || locationId || 'Selected location'}
              </InfoRow>

              <InfoRow label="Timezone">
                {resolvedTimeZone} · {step} minute step
              </InfoRow>

              {locationId ? (
                <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2 text-sm font-semibold text-[var(--paper-dim)]">
                  <input
                    type="checkbox"
                    checked={blockAllLocations}
                    onChange={(event) =>
                      setBlockAllLocations(event.target.checked)
                    }
                    disabled={saving}
                    className={checkboxClassName()}
                  />
                  Block all locations
                </label>
              ) : (
                <StateCard>
                  No location is selected, so this block will apply to all
                  locations.
                </StateCard>
              )}
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.03] p-4">
            <SectionHeading
              title="Time"
              description="Pick the start and duration for the unavailable window."
            />

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date">
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  disabled={saving}
                  className={fieldClassName()}
                />
              </Field>

              <Field label="Start time">
                <input
                  type="time"
                  step={step * 60}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  disabled={saving}
                  className={fieldClassName()}
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Duration minutes">
                <input
                  type="number"
                  step={step}
                  min={step}
                  max={720}
                  value={durationInput}
                  onChange={(event) => setDurationInput(event.target.value)}
                  disabled={saving}
                  inputMode="numeric"
                  className={fieldClassName()}
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Note optional">
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={saving}
                  maxLength={MAX_NOTE_LENGTH}
                  placeholder="Lunch, dentist, school pickup, deep sighing, etc."
                  className={[fieldClassName(), 'min-h-24 resize-none'].join(
                    ' ',
                  )}
                />
              </Field>

              <p className="mt-1 text-right font-mono text-[9px] font-black uppercase tracking-[0.08em] text-[var(--paper-mute)]">
                {note.length}/{MAX_NOTE_LENGTH}
              </p>
            </div>
          </section>
        </div>

        <footer className="border-t border-[var(--line-strong)] bg-[var(--ink)]/92 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className={buttonClassName('ghost')}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className={buttonClassName('primary')}
            >
              {saving ? 'Saving…' : 'Create block'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}

function SectionHeading(props: {
  title: string
  description: string
}) {
  const { title, description } = props

  return (
    <div>
      <h3 className="font-display text-2xl font-semibold italic tracking-[-0.04em] text-[var(--paper)]">
        {title}
      </h3>

      <p className="mt-1 text-sm leading-6 text-[var(--paper-dim)]">
        {description}
      </p>
    </div>
  )
}

function Field(props: {
  label: string
  children: ReactNode
}) {
  const { label, children } = props

  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
        {label}
      </span>

      {children}
    </label>
  )
}

function InfoRow(props: {
  label: string
  children: ReactNode
}) {
  const { label, children } = props

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2">
      <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-[var(--paper)]">
        {children}
      </p>
    </div>
  )
}

function StateCard(props: {
  children: ReactNode
  danger?: boolean
}) {
  const { children, danger = false } = props

  return (
    <div
      className={[
        'mb-3 rounded-2xl border px-3 py-3 text-sm font-semibold',
        danger
          ? 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
          : 'border-[var(--line)] bg-[var(--paper)]/[0.03] text-[var(--paper-dim)]',
      ].join(' ')}
    >
      {children}
    </div>
  )
}