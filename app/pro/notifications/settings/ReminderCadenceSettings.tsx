'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ToggleSwitch from '@/app/_components/ToggleSwitch'
import type {
  ProReminderSettingsResponseDTO,
  ReminderLeadUnit,
  ReminderPresetDTO,
} from '@/lib/dto/reminderSettings'

/**
 * Pro-facing editor for appointment-reminder cadence: a master on/off plus a
 * fully custom list of reminders, each with an arbitrary lead time (any number of
 * days OR hours before the appointment). Writes the structured reminders list
 * back to /api/v1/pro/reminder-settings; the server owns the bounds + presets.
 */

const ENDPOINT = '/api/v1/pro/reminder-settings'
const MAX_REMINDERS = 10

type LeadRow = {
  id: number
  value: string
  unit: ReminderLeadUnit
}

type State = {
  enabled: boolean
  leads: LeadRow[]
  presets: ReminderPresetDTO[]
}

function leadMinutes(value: number, unit: ReminderLeadUnit): number {
  return unit === 'days' ? value * 1440 : value * 60
}

/** A row is well-formed iff its value is a positive integer. */
function isRowValid(row: LeadRow): boolean {
  const n = Number(row.value)
  return Number.isInteger(n) && n > 0
}

export default function ReminderCadenceSettings() {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const nextRowId = useRef(0)

  const makeRow = useCallback(
    (value: number, unit: ReminderLeadUnit): LeadRow => {
      nextRowId.current += 1
      return { id: nextRowId.current, value: String(value), unit }
    },
    [],
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(ENDPOINT, { method: 'GET' })
      .then(async (res) => {
        const json: unknown = await res.json().catch(() => null)
        if (!res.ok || !json || typeof json !== 'object') {
          throw new Error('load failed')
        }
        return json as ProReminderSettingsResponseDTO
      })
      .then((data) => {
        if (!active) return
        setState({
          enabled: data.settings.enabled,
          leads: data.settings.leads.map((lead) =>
            makeRow(lead.value, lead.unit),
          ),
          presets: data.presets,
        })
        setError(null)
      })
      .catch(() => {
        if (active) setError('Could not load your reminder settings.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [makeRow])

  // Minutes already present, so preset quick-adds can show as "added" + dedupe.
  const presentMinutes = useMemo(() => {
    const set = new Set<number>()
    for (const row of state?.leads ?? []) {
      if (isRowValid(row)) set.add(leadMinutes(Number(row.value), row.unit))
    }
    return set
  }, [state?.leads])

  const setEnabled = useCallback((next: boolean) => {
    setSuccess(null)
    setState((prev) => (prev ? { ...prev, enabled: next } : prev))
  }, [])

  const updateRow = useCallback((id: number, patch: Partial<LeadRow>) => {
    setSuccess(null)
    setState((prev) =>
      prev
        ? {
            ...prev,
            leads: prev.leads.map((row) =>
              row.id === id ? { ...row, ...patch } : row,
            ),
          }
        : prev,
    )
  }, [])

  const removeRow = useCallback((id: number) => {
    setSuccess(null)
    setState((prev) =>
      prev ? { ...prev, leads: prev.leads.filter((row) => row.id !== id) } : prev,
    )
  }, [])

  const addLead = useCallback(
    (value: number, unit: ReminderLeadUnit) => {
      setSuccess(null)
      setState((prev) => {
        if (!prev) return prev
        if (prev.leads.length >= MAX_REMINDERS) return prev
        // Skip a preset already present (dedupe on the wire anyway).
        if (presentMinutes.has(leadMinutes(value, unit))) return prev
        return { ...prev, leads: [...prev.leads, makeRow(value, unit)] }
      })
    },
    [makeRow, presentMinutes],
  )

  const atMax = (state?.leads.length ?? 0) >= MAX_REMINDERS
  const hasInvalidRow = (state?.leads ?? []).some((row) => !isRowValid(row))

  const save = useCallback(async () => {
    if (!state) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: state.enabled,
          reminders: state.leads.map((row) => ({
            value: Number(row.value),
            unit: row.unit,
          })),
        }),
      })
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok || !json || typeof json !== 'object') {
        const message =
          json &&
          typeof json === 'object' &&
          'error' in json &&
          typeof (json as { error: unknown }).error === 'string'
            ? (json as { error: string }).error
            : 'Could not save your changes. Please try again.'
        throw new Error(message)
      }
      const data = json as ProReminderSettingsResponseDTO
      setState({
        enabled: data.settings.enabled,
        leads: data.settings.leads.map((lead) => makeRow(lead.value, lead.unit)),
        presets: data.presets,
      })
      setSuccess('Reminder settings saved.')
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save your changes. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }, [state, makeRow])

  if (loading) {
    return (
      <section className="brand-glass p-4 sm:p-5">
        <div className="text-sm font-semibold text-textSecondary">
          Loading reminder settings…
        </div>
      </section>
    )
  }

  if (!state) {
    return (
      <section className="brand-glass p-4 sm:p-5">
        <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
          {error ?? 'Could not load your reminder settings.'}
        </div>
      </section>
    )
  }

  return (
    <section className="brand-glass p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-md">
          <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
            Appointment reminders
          </div>
          <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
            Automatically remind clients before their appointment. Add as many
            reminders as you like and choose how far ahead each one goes — days or
            hours. We&apos;ll skip any reminder that&apos;s already in the past and
            never send during their quiet hours.
          </div>
        </div>
        <ToggleSwitch
          checked={state.enabled}
          onChange={setEnabled}
          label="Enable appointment reminders"
          size="md"
        />
      </div>

      {state.enabled ? (
        <div className="mt-4 flex flex-col gap-2">
          {state.leads.length === 0 ? (
            <div className="rounded-card border border-white/5 px-3 py-3 text-[11px] font-semibold text-textSecondary">
              No reminders yet — clients won&apos;t get an appointment reminder
              until you add at least one.
            </div>
          ) : (
            state.leads.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-2 rounded-card border border-white/5 px-3 py-2"
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  aria-label="Reminder lead time"
                  className="w-16 rounded-card border border-white/10 bg-bgPrimary/40 px-2 py-1.5 text-[13px] font-bold text-textPrimary outline-none focus:border-accentPrimary"
                />
                <select
                  value={row.unit}
                  onChange={(e) =>
                    updateRow(row.id, {
                      unit: e.target.value === 'hours' ? 'hours' : 'days',
                    })
                  }
                  aria-label="Reminder lead unit"
                  className="rounded-card border border-white/10 bg-bgPrimary/40 px-2 py-1.5 text-[13px] font-bold text-textPrimary outline-none focus:border-accentPrimary"
                >
                  <option value="days">days before</option>
                  <option value="hours">hours before</option>
                </select>
                {!isRowValid(row) ? (
                  <span className="text-[11px] font-bold text-toneDanger">
                    Enter a whole number
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove reminder"
                  className="ml-auto rounded-full border border-toneDanger/25 px-2 py-1 text-[11px] font-black text-toneDanger transition hover:bg-toneDanger/10"
                >
                  Remove
                </button>
              </div>
            ))
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {state.presets.map((preset) => {
              const added = presentMinutes.has(
                leadMinutes(preset.value, preset.unit),
              )
              return (
                <button
                  key={`${preset.value}-${preset.unit}`}
                  type="button"
                  disabled={added || atMax}
                  onClick={() => addLead(preset.value, preset.unit)}
                  className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-bold text-textPrimary transition hover:border-accentPrimary disabled:opacity-40"
                >
                  {added ? `✓ ${preset.label}` : `+ ${preset.label}`}
                </button>
              )
            })}
            <button
              type="button"
              disabled={atMax}
              onClick={() => addLead(1, 'days')}
              className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-black text-textPrimary transition hover:border-accentPrimary disabled:opacity-40"
            >
              + Add reminder
            </button>
          </div>
          {atMax ? (
            <div className="text-[11px] font-semibold text-textSecondary">
              You&apos;ve reached the maximum of {MAX_REMINDERS} reminders.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-[11px] font-semibold text-textSecondary">
          Appointment reminders are turned off. Clients won&apos;t get automatic
          reminders before their bookings.
        </div>
      )}

      {error ? (
        <div className="mt-4 rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mt-4 rounded-card border border-toneSuccess/30 bg-toneSuccess/10 px-3 py-2 text-sm font-bold text-toneSuccess">
          {success}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || (state.enabled && hasInvalidRow)}
          className="rounded-full bg-accentPrimary px-5 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save reminders'}
        </button>
      </div>
    </section>
  )
}
