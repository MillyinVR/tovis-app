// app/pro/calendar/EditBlockModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  DEFAULT_TIME_ZONE,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
  ymdInTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { readErrorMessage, safeJson } from '@/lib/http'
import { parseHHMM } from '@/lib/scheduling/workingHours'

import {
  computeDurationMinutesFromIso,
  MAX_DURATION,
  normalizeStepMinutes,
  roundDurationMinutes,
  snapMinutes,
} from './_utils/calendarMath'

// ─── Types ────────────────────────────────────────────────────────────────────

type EditBlockModalProps = {
  open: boolean
  blockId: string | null
  timeZone: string
  stepMinutes?: number | null
  onClose: () => void
  onSaved: () => void
}

type BlockDto = {
  id: string
  startsAt: string
  endsAt: string
  note: string | null
}

type DateParts = {
  year: number
  month: number
  day: number
}

type PatchBlockPayload = {
  startsAt: string
  endsAt: string
  note: string | null
}

type ButtonTone = 'primary' | 'danger' | 'ghost'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MINUTES = 60
const MAX_NOTE_LENGTH = 160

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredString(value: unknown, errorMessage: string) {
  const stringValue = optionalString(value)

  if (!stringValue) {
    throw new Error(errorMessage)
  }

  return stringValue
}

function parseBlockDto(data: unknown): BlockDto {
  const raw = isRecord(data) && isRecord(data.block) ? data.block : data

  if (!isRecord(raw)) {
    throw new Error('Malformed block payload.')
  }

  return {
    id: requiredString(raw.id, 'Block payload was missing an id.'),
    startsAt: requiredString(
      raw.startsAt,
      'Block payload was missing a start time.',
    ),
    endsAt: requiredString(
      raw.endsAt,
      'Block payload was missing an end time.',
    ),
    note: typeof raw.note === 'string' ? raw.note : null,
  }
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function timeInputFromMinutes(minutes: number) {
  const snapped = snapMinutes(minutes, 1)
  const hour = Math.floor(snapped / 60)
  const minute = snapped % 60

  return `${pad2(hour)}:${pad2(minute)}`
}

function parseDateInput(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const checkDate = new Date(Date.UTC(year, month - 1, day))
  const valid =
    checkDate.getUTCFullYear() === year &&
    checkDate.getUTCMonth() === month - 1 &&
    checkDate.getUTCDate() === day

  return valid ? { year, month, day } : null
}

function parseDurationInput(value: string, stepMinutes: number) {
  const raw = Number(value)

  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error('Pick a valid duration.')
  }

  return roundDurationMinutes(raw, stepMinutes)
}

function buildPatchPayload(args: {
  date: string
  startTime: string
  durationInput: string
  note: string
  timeZone: string
  stepMinutes: number
}): PatchBlockPayload {
  const parsedDate = parseDateInput(args.date)

  if (!parsedDate) {
    throw new Error('Pick a valid date.')
  }

  const parsedTime = parseHHMM(args.startTime)

  if (!parsedTime) {
    throw new Error('Pick a valid start time.')
  }

  const durationMinutes = parseDurationInput(
    args.durationInput,
    args.stepMinutes,
  )

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
  }
}

function blockEndpoint(blockId: string) {
  return `/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`
}

function readResponseError(data: unknown, fallback: string) {
  return readErrorMessage(data) ?? fallback
}

function buttonClassName(tone: ButtonTone = 'ghost') {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-ink hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  if (tone === 'danger') {
    return [
      base,
      'border border-toneDanger/30 bg-toneDanger/10 text-toneDanger hover:bg-toneDanger/15',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-transparent text-paperMute',
    'hover:bg-paper/5 hover:text-paper',
  ].join(' ')
}

function fieldClassName() {
  return [
    'w-full rounded-xl border border-[var(--line)] bg-ink2 px-3 py-2',
    'text-sm font-semibold text-paper placeholder:text-paperMute',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
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
  busy: boolean
  onClose: () => void
}) {
  const { open, busy, onClose } = args

  if (!open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) {
      onClose()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

// ─── Exported component ───────────────────────────────────────────────────────

export default function EditBlockModal(props: EditBlockModalProps) {
  const {
    open,
    blockId,
    timeZone,
    stepMinutes,
    onClose,
    onSaved,
  } = props

  const resolvedTimeZone = useMemo(
    () => sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE),
    [timeZone],
  )

  const step = useMemo(
    () => normalizeStepMinutes(stepMinutes),
    [stepMinutes],
  )

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [block, setBlock] = useState<BlockDto | null>(null)

  const [dateInput, setDateInput] = useState('')
  const [startTimeInput, setStartTimeInput] = useState('')
  const [durationInput, setDurationInput] = useState(
    String(DEFAULT_DURATION_MINUTES),
  )
  const [note, setNote] = useState('')

  const busy = loading || saving || deleting
  const canEdit = open && blockId !== null && block !== null && !loading

  useEffect(() => lockBodyScroll(open), [open])

  useEffect(
    () =>
      closeOnEscape({
        open,
        busy,
        onClose,
      }),
    [open, busy, onClose],
  )

  useEffect(() => {
    if (!open) {
      setError(null)
      setBlock(null)
      return
    }

    if (!blockId) {
      setError(null)
      setBlock(null)
      setDateInput('')
      setStartTimeInput('')
      setDurationInput(String(DEFAULT_DURATION_MINUTES))
      setNote('')
      return
    }

    const selectedBlockId = blockId
    let cancelled = false

    async function loadBlock() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(blockEndpoint(selectedBlockId), {
          cache: 'no-store',
        })

        const data: unknown = await safeJson(response)

        if (!response.ok) {
          throw new Error(
            readResponseError(
              data,
              `Failed to load block (${response.status}).`,
            ),
          )
        }

        const loadedBlock = parseBlockDto(data)

        if (cancelled) return

        const startsAt = new Date(loadedBlock.startsAt)
        const startMinutes = minutesSinceMidnightInTimeZone(
          startsAt,
          resolvedTimeZone,
        )

        const durationMinutes = roundDurationMinutes(
          computeDurationMinutesFromIso(
            loadedBlock.startsAt,
            loadedBlock.endsAt,
          ),
          step,
        )

        setBlock(loadedBlock)
        setDateInput(ymdInTimeZone(startsAt, resolvedTimeZone))
        setStartTimeInput(timeInputFromMinutes(startMinutes))
        setDurationInput(String(durationMinutes))
        setNote(loadedBlock.note ?? '')
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : 'Failed to load block.',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadBlock()

    return () => {
      cancelled = true
    }
  }, [blockId, open, resolvedTimeZone, step])

  function close() {
    if (saving || deleting) return

    setError(null)
    onClose()
  }

  async function save() {
    const selectedBlockId = blockId

    if (!selectedBlockId || !block || saving || deleting) return

    setSaving(true)
    setError(null)

    try {
      const payload = buildPatchPayload({
        date: dateInput,
        startTime: startTimeInput,
        durationInput,
        note,
        timeZone: resolvedTimeZone,
        stepMinutes: step,
      })

      const response = await fetch(blockEndpoint(selectedBlockId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(readResponseError(data, 'Failed to save.'))
      }

      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const selectedBlockId = blockId

    if (!selectedBlockId || deleting || saving) return

    setDeleting(true)
    setError(null)

    try {
      const response = await fetch(blockEndpoint(selectedBlockId), {
        method: 'DELETE',
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(readResponseError(data, 'Failed to delete.'))
      }

      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to delete.')
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-ink',
          'shadow-[0_28px_90px_rgb(0_0_0_/_0.62)]',
          'sm:max-w-[34rem] sm:rounded-[24px]',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-block-modal-title"
      >
        <header className="border-b border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-paper/20 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-terraGlow">
                ◆ Calendar block
              </p>

              <h2
                id="edit-block-modal-title"
                className="mt-1 font-display text-3xl font-semibold italic tracking-[-0.05em] text-paper"
              >
                Edit blocked time.
              </h2>

              <p className="mt-1 text-sm leading-6 text-paperDim">
                Adjust or remove the unavailable window from your calendar.
              </p>
            </div>

            <button
              type="button"
              onClick={close}
              disabled={saving || deleting}
              className={buttonClassName('ghost')}
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {!blockId ? <StateCard>No block selected.</StateCard> : null}

          {blockId && loading ? <StateCard>Loading block…</StateCard> : null}

          {error ? <StateCard danger>{error}</StateCard> : null}

          {canEdit ? (
            <div className="grid gap-4">
              <section className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4">
                <SectionHeading
                  title="Block details"
                  description="Edit the unavailable window using the calendar timezone and step size."
                />

                <div className="mt-4 grid gap-3">
                  <InfoRow label="Timezone">
                    {resolvedTimeZone} · {step} minute step
                  </InfoRow>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4">
                <SectionHeading
                  title="Time"
                  description="Change when the block starts and how long it lasts."
                />

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Date">
                    <input
                      type="date"
                      value={dateInput}
                      onChange={(event) => setDateInput(event.target.value)}
                      disabled={busy}
                      className={fieldClassName()}
                    />
                  </Field>

                  <Field label="Start time">
                    <input
                      type="time"
                      step={step * 60}
                      value={startTimeInput}
                      onChange={(event) =>
                        setStartTimeInput(event.target.value)
                      }
                      disabled={busy}
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
                      max={MAX_DURATION}
                      value={durationInput}
                      onChange={(event) =>
                        setDurationInput(event.target.value)
                      }
                      disabled={busy}
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
                      disabled={busy}
                      maxLength={MAX_NOTE_LENGTH}
                      placeholder="Lunch, admin time, school pickup…"
                      className={[fieldClassName(), 'min-h-24 resize-none'].join(
                        ' ',
                      )}
                    />
                  </Field>

                  <p className="mt-1 text-right font-mono text-[9px] font-black uppercase tracking-[0.08em] text-paperMute">
                    {note.length}/{MAX_NOTE_LENGTH}
                  </p>
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={!blockId || saving || deleting || loading}
              className={buttonClassName('danger')}
            >
              {deleting ? 'Deleting…' : 'Delete block'}
            </button>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={close}
                disabled={saving || deleting}
                className={buttonClassName('ghost')}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={!canEdit || saving || deleting}
                className={buttonClassName('primary')}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </footer>
      </form>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeading(props: {
  title: string
  description: string
}) {
  const { title, description } = props

  return (
    <div>
      <h3 className="font-display text-2xl font-semibold italic tracking-[-0.04em] text-paper">
        {title}
      </h3>

      <p className="mt-1 text-sm leading-6 text-paperDim">
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
      <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
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
    <div className="rounded-xl border border-[var(--line)] bg-ink2 px-3 py-2">
      <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-paper">
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
          : 'border-[var(--line)] bg-paper/[0.03] text-paperDim',
      ].join(' ')}
    >
      {children}
    </div>
  )
}