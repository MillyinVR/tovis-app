// app/client/(gated)/settings/ClientSelfProfileSettings.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'
import {
  SELF_PROFILE_FIELD_KEYS,
  SELF_PROFILE_INTEREST_OPTIONS,
  SELF_PROFILE_QUESTIONS,
  normalizeSelfProfile,
  type ClientSelfProfile,
  type SelfProfileFieldKey,
} from '@/lib/personalization/selfProfile'

type DraftState = {
  fields: Partial<Record<SelfProfileFieldKey, string>>
  interests: string[]
}

function toDraft(profile: ClientSelfProfile | null): DraftState {
  const fields: DraftState['fields'] = {}
  for (const key of SELF_PROFILE_FIELD_KEYS) {
    const value = profile?.[key]
    if (typeof value === 'string') fields[key] = value
  }
  return { fields, interests: [...(profile?.interests ?? [])] }
}

function draftsEqual(a: DraftState, b: DraftState): boolean {
  if (
    SELF_PROFILE_FIELD_KEYS.some((key) => (a.fields[key] ?? null) !== (b.fields[key] ?? null))
  ) {
    return false
  }
  return (
    a.interests.length === b.interests.length &&
    a.interests.every((value) => b.interests.includes(value))
  )
}

function pickSelfProfile(raw: unknown): ClientSelfProfile | null {
  if (!isRecord(raw)) return null
  return normalizeSelfProfile(raw.selfProfile)
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[12px] font-bold transition',
        selected
          ? 'border-white/40 bg-bgPrimary text-textPrimary'
          : 'border-white/10 bg-bgPrimary/60 text-textSecondary hover:border-white/20 hover:text-textPrimary',
      )}
    >
      {children}
    </button>
  )
}

export default function ClientSelfProfileSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [saved, setSaved] = useState<DraftState>(() => toDraft(null))
  const [draft, setDraft] = useState<DraftState>(() => toDraft(null))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/client/self-profile', {
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(raw) ?? 'Failed to load.')
      const next = toDraft(pickSelfProfile(raw))
      setSaved(next)
      setDraft(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => !draftsEqual(draft, saved), [draft, saved])

  function toggleField(key: SelfProfileFieldKey, value: string) {
    setDraft((current) => {
      const fields = { ...current.fields }
      if (fields[key] === value) {
        delete fields[key]
      } else {
        fields[key] = value
      }
      return { ...current, fields }
    })
  }

  function toggleInterest(value: string) {
    setDraft((current) => ({
      ...current,
      interests: current.interests.includes(value)
        ? current.interests.filter((entry) => entry !== value)
        : [...current.interests, value],
    }))
  }

  async function onSave() {
    if (saving || !dirty) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const body: Record<string, unknown> = { interests: draft.interests }
      for (const key of SELF_PROFILE_FIELD_KEYS) {
        body[key] = draft.fields[key] ?? null
      }

      const res = await fetch('/api/v1/client/self-profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      })
      const raw = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(raw) ?? 'Failed to save.')
      const next = toDraft(pickSelfProfile(raw))
      setSaved(next)
      setDraft(next)
      setSuccess('Profile updated.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="brand-glass p-5 sm:p-6">
      <div className="mb-4">
        <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
          Get better matches
        </div>
        <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
          Tell us about your hair, skin, and what you&apos;re into — every field
          is optional, and everything here only comes from you. Tap a selected
          chip to clear it.
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-textSecondary">Loading…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-2 text-xs font-black tracking-[var(--ls-caps)] text-textSecondary">
              What are you into?
            </div>
            <div className="flex flex-wrap gap-2">
              {SELF_PROFILE_INTEREST_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  selected={draft.interests.includes(option.value)}
                  onClick={() => toggleInterest(option.value)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
          </div>

          {SELF_PROFILE_QUESTIONS.map((question) => (
            <div key={question.key}>
              <div className="mb-2 text-xs font-black tracking-[var(--ls-caps)] text-textSecondary">
                {question.label}
              </div>
              <div className="flex flex-wrap gap-2">
                {question.options.map((option) => (
                  <Chip
                    key={option.value}
                    selected={draft.fields[question.key] === option.value}
                    onClick={() => toggleField(question.key, option.value)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}

          {error ? (
            <div className="rounded-card border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-xs text-toneDanger">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="rounded-card border border-toneSuccess/30 bg-toneSuccess/10 px-3 py-2 text-xs text-toneSuccess">
              {success}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !dirty}
              className="rounded-full bg-accentPrimary px-5 py-2 text-sm font-bold text-bgPrimary transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
