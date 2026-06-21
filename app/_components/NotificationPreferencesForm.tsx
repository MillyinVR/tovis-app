'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import ToggleSwitch from '@/app/_components/ToggleSwitch'

/**
 * Shared notification-preferences editor for both client and pro settings. It
 * is audience-agnostic: it reads the grouped category metadata + effective
 * channel state from `endpoint` (GET) and writes the full declarative state
 * back (PATCH). The server owns categories, supported channels, and owner
 * scoping; this component only renders toggles for what the API returns.
 */

type ChannelId = 'IN_APP' | 'SMS' | 'EMAIL'

type ChannelState = {
  inAppEnabled: boolean
  smsEnabled: boolean
  emailEnabled: boolean
}

type EventMeta = {
  eventKey: string
  label: string
  supportedChannels: ChannelId[]
}

type CategoryMeta = {
  key: string
  label: string
  description: string
  events: EventMeta[]
}

type QuietHoursState = {
  enabled: boolean
  startMinutes: number
  endMinutes: number
}

type PreferencesPayload = {
  categories: CategoryMeta[]
  events: Record<string, ChannelState>
  quietHours: QuietHoursState
}

const CHANNELS: Record<ChannelId, { stateKey: keyof ChannelState; label: string }> = {
  IN_APP: { stateKey: 'inAppEnabled', label: 'In-app' },
  SMS: { stateKey: 'smsEnabled', label: 'SMS' },
  EMAIL: { stateKey: 'emailEnabled', label: 'Email' },
}

function minutesToTimeValue(minutes: number): string {
  const safe = Math.min(1439, Math.max(0, Math.trunc(minutes)))
  const h = String(Math.floor(safe / 60)).padStart(2, '0')
  const m = String(safe % 60).padStart(2, '0')
  return `${h}:${m}`
}

function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

export default function NotificationPreferencesForm({
  endpoint,
}: {
  endpoint: string
}) {
  const [payload, setPayload] = useState<PreferencesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(endpoint, { method: 'GET' })
      .then(async (res) => {
        const json: unknown = await res.json().catch(() => null)
        if (!res.ok || !json || typeof json !== 'object') {
          throw new Error('Failed to load notification preferences.')
        }
        return json as PreferencesPayload & { ok?: boolean }
      })
      .then((data) => {
        if (!active) return
        setPayload({
          categories: data.categories,
          events: data.events,
          quietHours: data.quietHours,
        })
        setError(null)
      })
      .catch(() => {
        if (active) setError('Could not load your notification settings.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [endpoint])

  const setChannel = useCallback(
    (eventKey: string, stateKey: keyof ChannelState, next: boolean) => {
      setSuccess(null)
      setPayload((prev) => {
        if (!prev) return prev
        const current = prev.events[eventKey] ?? {
          inAppEnabled: true,
          smsEnabled: true,
          emailEnabled: true,
        }
        return {
          ...prev,
          events: {
            ...prev.events,
            [eventKey]: { ...current, [stateKey]: next },
          },
        }
      })
    },
    [],
  )

  const setQuietHours = useCallback((next: Partial<QuietHoursState>) => {
    setSuccess(null)
    setPayload((prev) =>
      prev ? { ...prev, quietHours: { ...prev.quietHours, ...next } } : prev,
    )
  }, [])

  const quietHoursInvalid = useMemo(() => {
    const qh = payload?.quietHours
    if (!qh || !qh.enabled) return false
    return qh.startMinutes === qh.endMinutes
  }, [payload])

  const save = useCallback(async () => {
    if (!payload) return
    if (quietHoursInvalid) {
      setError('Quiet hours start and end times cannot be the same.')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          events: payload.events,
          quietHours: payload.quietHours,
        }),
      })
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok || !json || typeof json !== 'object') {
        throw new Error('save failed')
      }
      const data = json as PreferencesPayload
      setPayload({
        categories: data.categories,
        events: data.events,
        quietHours: data.quietHours,
      })
      setSuccess('Notification preferences saved.')
    } catch {
      setError('Could not save your changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [endpoint, payload, quietHoursInvalid])

  if (loading) {
    return (
      <div className="text-sm font-semibold text-textSecondary">
        Loading notification settings…
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
        {error ?? 'Could not load your notification settings.'}
      </div>
    )
  }

  const qh = payload.quietHours

  return (
    <div className="flex flex-col gap-5">
      {/* SMS consent note */}
      <div className="rounded-card border border-toneInfo/30 bg-toneInfo/10 px-3 py-2 text-xs font-semibold leading-5 text-textSecondary">
        SMS messages are only sent when you have a verified phone number and have
        consented to receive texts. Turning SMS on here won&apos;t send texts until
        both are in place.
      </div>

      {/* Quiet hours */}
      <section className="brand-glass p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-md">
            <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
              Quiet hours
            </div>
            <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
              Pause SMS and email during these hours (urgent alerts may still come
              through). In-app notifications are never paused.
            </div>
          </div>
          <ToggleSwitch
            checked={qh.enabled}
            onChange={(next) => setQuietHours({ enabled: next })}
            label="Enable quiet hours"
            size="md"
          />
        </div>

        {qh.enabled ? (
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textSecondary">
                From
              </span>
              <input
                type="time"
                value={minutesToTimeValue(qh.startMinutes)}
                onChange={(e) => {
                  const minutes = timeValueToMinutes(e.target.value)
                  if (minutes !== null) setQuietHours({ startMinutes: minutes })
                }}
                className="rounded-card border border-white/10 bg-bgSecondary/40 px-3 py-2 text-sm font-semibold text-textPrimary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textSecondary">
                To
              </span>
              <input
                type="time"
                value={minutesToTimeValue(qh.endMinutes)}
                onChange={(e) => {
                  const minutes = timeValueToMinutes(e.target.value)
                  if (minutes !== null) setQuietHours({ endMinutes: minutes })
                }}
                className="rounded-card border border-white/10 bg-bgSecondary/40 px-3 py-2 text-sm font-semibold text-textPrimary"
              />
            </label>
          </div>
        ) : null}

        {quietHoursInvalid ? (
          <div className="mt-3 text-[12px] font-bold text-toneDanger">
            Start and end times can&apos;t be the same.
          </div>
        ) : null}
      </section>

      {/* Categories */}
      {payload.categories.map((category) => (
        <section key={category.key} className="brand-glass p-4 sm:p-5">
          <div className="mb-3">
            <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
              {category.label}
            </div>
            <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
              {category.description}
            </div>
          </div>

          <div className="flex flex-col divide-y divide-white/5">
            {category.events.map((event) => {
              const state = payload.events[event.eventKey] ?? {
                inAppEnabled: true,
                smsEnabled: true,
                emailEnabled: true,
              }
              return (
                <div
                  key={event.eventKey}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="text-[13px] font-bold text-textPrimary">
                    {event.label}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    {event.supportedChannels.map((channel) => {
                      const meta = CHANNELS[channel]
                      return (
                        <div
                          key={channel}
                          className="flex items-center gap-2"
                        >
                          <span className="text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textSecondary">
                            {meta.label}
                          </span>
                          <ToggleSwitch
                            checked={state[meta.stateKey]}
                            onChange={(next) =>
                              setChannel(event.eventKey, meta.stateKey, next)
                            }
                            label={`${event.label} — ${meta.label}`}
                            size="sm"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {error ? (
        <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-card border border-toneSuccess/30 bg-toneSuccess/10 px-3 py-2 text-sm font-bold text-toneSuccess">
          {success}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || quietHoursInvalid}
          className="rounded-full bg-accentPrimary px-5 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  )
}
