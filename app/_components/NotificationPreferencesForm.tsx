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
  // Critical events (e.g. payment receipts) whose email can never be turned off.
  emailLocked?: boolean
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

export type PreferencesPayload = {
  categories: CategoryMeta[]
  events: Record<string, ChannelState>
  quietHours: QuietHoursState
}

const CHANNELS: Record<ChannelId, { stateKey: keyof ChannelState; label: string }> = {
  IN_APP: { stateKey: 'inAppEnabled', label: 'In-app' },
  SMS: { stateKey: 'smsEnabled', label: 'SMS' },
  EMAIL: { stateKey: 'emailEnabled', label: 'Email' },
}

// A single "how do you want to hear from us" choice. PUSH is reserved for when
// push notifications ship — it's shown disabled today.
type ChannelPreference = 'EMAIL' | 'SMS' | 'PUSH'

function eventSupportedChannels(
  categories: CategoryMeta[],
): Map<string, ChannelId[]> {
  const map = new Map<string, ChannelId[]>()
  for (const category of categories) {
    for (const event of category.events) {
      map.set(event.eventKey, event.supportedChannels)
    }
  }
  return map
}

// Events whose email is mandatory (payment receipts etc.) — the primary-channel
// mapping must keep their email on, and they don't count toward deciding the
// active primary channel.
function lockedEmailEvents(categories: CategoryMeta[]): Set<string> {
  const set = new Set<string>()
  for (const category of categories) {
    for (const event of category.events) {
      if (event.emailLocked) set.add(event.eventKey)
    }
  }
  return set
}

// Which single external channel the current toggles correspond to, or null when
// it's a mix the simple selector can't represent ("Custom"). We only look at
// events that support BOTH email and SMS — those are the ones a primary-channel
// choice actually decides between.
export function deriveActivePreference(
  payload: PreferencesPayload,
): ChannelPreference | null {
  const supported = eventSupportedChannels(payload.categories)
  const locked = lockedEmailEvents(payload.categories)
  let sawDual = false
  let allEmail = true
  let allSms = true

  for (const [eventKey, channels] of supported) {
    // Email-locked events are forced to email; they're not part of the choice.
    if (locked.has(eventKey)) continue
    if (!channels.includes('EMAIL') || !channels.includes('SMS')) continue
    sawDual = true
    const state = payload.events[eventKey]
    if (!state) continue
    if (!(state.emailEnabled && !state.smsEnabled)) allEmail = false
    if (!(state.smsEnabled && !state.emailEnabled)) allSms = false
  }

  if (!sawDual) return null
  if (allEmail) return 'EMAIL'
  if (allSms) return 'SMS'
  return null
}

// Map a primary-channel choice onto every event's per-channel toggles. Rules:
// - In-app is never touched (it's the durable inbox and is never paused).
// - The chosen channel is enabled wherever the event supports it.
// - The other external channel is disabled ONLY when the chosen channel is also
//   available for that event — so an email-only event still emails under "Text",
//   and no event is ever fully silenced.
export function applyPreferredChannel(
  payload: PreferencesPayload,
  channel: 'EMAIL' | 'SMS',
): Record<string, ChannelState> {
  const supported = eventSupportedChannels(payload.categories)
  const locked = lockedEmailEvents(payload.categories)
  const nextEvents: Record<string, ChannelState> = {}

  for (const [eventKey, channels] of supported) {
    const current = payload.events[eventKey] ?? {
      inAppEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
    }
    const supportsEmail = channels.includes('EMAIL')
    const supportsSms = channels.includes('SMS')
    const supportsBoth = supportsEmail && supportsSms
    const emailMandatory = locked.has(eventKey)

    if (channel === 'EMAIL') {
      nextEvents[eventKey] = {
        inAppEnabled: current.inAppEnabled,
        emailEnabled: supportsEmail ? true : current.emailEnabled,
        smsEnabled: supportsBoth ? false : current.smsEnabled,
      }
    } else {
      nextEvents[eventKey] = {
        inAppEnabled: current.inAppEnabled,
        smsEnabled: supportsSms ? true : current.smsEnabled,
        // A critical event keeps email on no matter what; otherwise email turns
        // off only when SMS is an available alternative for this event.
        emailEnabled: emailMandatory
          ? true
          : supportsBoth
            ? false
            : current.emailEnabled,
      }
    }
  }

  return { ...payload.events, ...nextEvents }
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
  showChannelPreference = false,
}: {
  endpoint: string
  // When true, render a simple "preferred channel" selector (Email / Text /
  // Push-coming-soon) above the detailed per-notification toggles.
  showChannelPreference?: boolean
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

  const choosePreferredChannel = useCallback((channel: 'EMAIL' | 'SMS') => {
    setSuccess(null)
    setPayload((prev) =>
      prev ? { ...prev, events: applyPreferredChannel(prev, channel) } : prev,
    )
  }, [])

  const activePreference = useMemo(
    () => (payload ? deriveActivePreference(payload) : null),
    [payload],
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

  const preferenceOptions: {
    id: ChannelPreference
    label: string
    hint: string
    disabled?: boolean
  }[] = [
    { id: 'EMAIL', label: 'Email', hint: 'Get them in your inbox' },
    { id: 'SMS', label: 'Text', hint: 'Get them by SMS' },
    {
      id: 'PUSH',
      label: 'Push',
      hint: 'Coming soon',
      disabled: true,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Preferred channel */}
      {showChannelPreference ? (
        <section className="brand-glass p-4 sm:p-5">
          <div className="max-w-md">
            <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
              How would you like to hear from us?
            </div>
            <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
              Pick one and we&apos;ll send notifications there instead of every
              channel. You&apos;ll always see them in-app, and you can still
              fine-tune individual notifications below.
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {preferenceOptions.map((option) => {
              const active = !option.disabled && activePreference === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled}
                  aria-pressed={active}
                  onClick={() =>
                    option.disabled
                      ? undefined
                      : choosePreferredChannel(option.id as 'EMAIL' | 'SMS')
                  }
                  className={[
                    'flex flex-col items-start gap-0.5 rounded-card border px-3 py-2 text-left transition',
                    option.disabled
                      ? 'cursor-not-allowed border-textPrimary/10 opacity-60'
                      : active
                        ? 'border-transparent bg-accentPrimary text-bgPrimary'
                        : 'border-textPrimary/15 text-textPrimary hover:border-textPrimary/30',
                  ].join(' ')}
                >
                  <span className="text-[13px] font-black">{option.label}</span>
                  <span
                    className={[
                      'text-[11px] font-semibold',
                      active ? 'text-bgPrimary/80' : 'text-textSecondary',
                    ].join(' ')}
                  >
                    {option.hint}
                  </span>
                </button>
              )
            })}
          </div>

          {activePreference === null ? (
            <div className="mt-2 text-[11px] font-semibold text-textSecondary">
              Your notifications are customized below.
            </div>
          ) : null}
        </section>
      ) : null}

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
                      // Critical events (payment receipts etc.) always email —
                      // the toggle is locked on so the UI matches the engine.
                      const emailLocked =
                        channel === 'EMAIL' && event.emailLocked === true
                      return (
                        <div
                          key={channel}
                          className="flex items-center gap-2"
                        >
                          <span className="text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textSecondary">
                            {meta.label}
                            {emailLocked ? (
                              <span className="ml-1 normal-case text-textSecondary/70">
                                (always on)
                              </span>
                            ) : null}
                          </span>
                          <ToggleSwitch
                            checked={emailLocked ? true : state[meta.stateKey]}
                            onChange={(next) =>
                              setChannel(event.eventKey, meta.stateKey, next)
                            }
                            label={`${event.label} — ${meta.label}`}
                            size="sm"
                            disabled={emailLocked}
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
