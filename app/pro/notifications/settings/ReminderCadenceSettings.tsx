'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import ToggleSwitch from '@/app/_components/ToggleSwitch'
import type {
  ProReminderSettingsResponseDTO,
  ReminderOffsetOptionDTO,
} from '@/lib/dto/reminderSettings'

/**
 * Pro-facing editor for appointment-reminder cadence: a master on/off plus a
 * checkbox per supported offset (1 week / 3 days / 1 day before). Writes the
 * full state back to /api/v1/pro/reminder-settings. The server owns the menu of
 * options, so this component renders only what the API returns.
 */

const ENDPOINT = '/api/v1/pro/reminder-settings'

type State = {
  enabled: boolean
  offsetDays: number[]
  options: ReminderOffsetOptionDTO[]
}

export default function ReminderCadenceSettings() {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
          offsetDays: data.settings.offsetDays,
          options: data.options,
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
  }, [])

  const selected = useMemo(
    () => new Set(state?.offsetDays ?? []),
    [state?.offsetDays],
  )

  const setEnabled = useCallback((next: boolean) => {
    setSuccess(null)
    setState((prev) => (prev ? { ...prev, enabled: next } : prev))
  }, [])

  const toggleOffset = useCallback((days: number, next: boolean) => {
    setSuccess(null)
    setState((prev) => {
      if (!prev) return prev
      const set = new Set(prev.offsetDays)
      if (next) set.add(days)
      else set.delete(days)
      return {
        ...prev,
        offsetDays: Array.from(set).sort((a, b) => b - a),
      }
    })
  }, [])

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
          offsetDays: state.offsetDays,
        }),
      })
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok || !json || typeof json !== 'object') {
        throw new Error('save failed')
      }
      const data = json as ProReminderSettingsResponseDTO
      setState({
        enabled: data.settings.enabled,
        offsetDays: data.settings.offsetDays,
        options: data.options,
      })
      setSuccess('Reminder settings saved.')
    } catch {
      setError('Could not save your changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [state])

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
            Automatically remind clients before their appointment. Choose how far
            ahead to send — we&apos;ll skip any reminder that&apos;s already in the
            past and never send during their quiet hours.
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
        <div className="mt-4 flex flex-col divide-y divide-white/5">
          {state.options.map((option) => (
            <div
              key={option.days}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="text-[13px] font-bold text-textPrimary">
                {option.label}
              </div>
              <ToggleSwitch
                checked={selected.has(option.days)}
                onChange={(next) => toggleOffset(option.days, next)}
                label={`Send a reminder ${option.label.toLowerCase()}`}
                size="sm"
              />
            </div>
          ))}
          {state.offsetDays.length === 0 ? (
            <div className="pt-3 text-[11px] font-semibold text-textSecondary">
              No reminders selected — clients won&apos;t get an appointment
              reminder until you pick at least one.
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
          disabled={saving}
          className="rounded-full bg-accentPrimary px-5 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save reminders'}
        </button>
      </div>
    </section>
  )
}
