// app/pro/bookings/[id]/aftercare/ClientProfilePanel.tsx
'use client'

// Inline, dark-themed view + editor for the client's private pro-only profile
// (allergies + professional notes), embedded on the aftercare page so the pro
// can record allergies/feedback at closeout without leaving. Reuses the same
// backend the full /pro/clients/[id] page uses:
//   POST /api/pro/clients/[id]/allergies
//   POST /api/pro/clients/[id]/notes
// Both are gated server-side by assertProCanViewClient, which this booking
// already satisfies. A successful add calls router.refresh() so the
// server-rendered lists below pick up the new row.

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const
type Severity = (typeof SEVERITIES)[number]

const NOTE_BODY_MAX = 4000
const NOTE_TITLE_MAX = 80

export type AllergyItem = {
  id: string
  label: string
  severity: string
  description: string | null
  createdAt: string
  recordedByName: string | null
}

export type ClientNoteItem = {
  id: string
  title: string | null
  body: string
  createdAt: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d)
  } catch {
    return ''
  }
}

function errorFromResponse(res: Response, data: unknown): string {
  if (isRecord(data) && typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim()
  }
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

const inputClass =
  'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none focus:border-white/20'
const labelClass = 'mb-1 block text-xs font-black text-textSecondary'
const sectionTitleClass = 'text-sm font-black text-textPrimary'

function addBtn(disabled: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black transition',
    disabled
      ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60'
      : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
  ].join(' ')
}

function AllergyForm({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('MODERATE')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setError(null)

    const l = label.trim()
    if (!l) {
      setError('Add what they’re allergic/sensitive to.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        `/api/pro/clients/${encodeURIComponent(clientId)}/allergies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: l,
            description: description.trim() || null,
            severity,
          }),
        },
      )
      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }
      setLabel('')
      setDescription('')
      setSeverity('MODERATE')
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3"
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div>
          <label className={labelClass} htmlFor="ac-allergy-label">
            Allergy / sensitivity
          </label>
          <input
            id="ac-allergy-label"
            value={label}
            disabled={loading}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. PPD, latex, lash glue, fragrance"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="ac-allergy-severity">
            Severity
          </label>
          <select
            id="ac-allergy-severity"
            value={severity}
            disabled={loading}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className={inputClass}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="ac-allergy-desc">
          Detail (optional)
        </label>
        <input
          id="ac-allergy-desc"
          value={description}
          disabled={loading}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. scalp redness, prefers patch tests"
          className={inputClass}
        />
      </div>

      {error ? (
        <div className="text-xs font-semibold text-microAccent">{error}</div>
      ) : null}

      <div className="flex justify-end">
        <button type="submit" disabled={loading} className={addBtn(loading)}>
          {loading ? 'Saving…' : 'Add allergy'}
        </button>
      </div>
    </form>
  )
}

function NoteForm({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setError(null)

    const b = body.trim()
    if (!b) {
      setError('Write a note first.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        `/api/pro/clients/${encodeURIComponent(clientId)}/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || null,
            body: b.slice(0, NOTE_BODY_MAX),
          }),
        },
      )
      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }
      setTitle('')
      setBody('')
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3"
    >
      <div>
        <label className={labelClass} htmlFor="ac-note-title">
          Title (optional)
        </label>
        <input
          id="ac-note-title"
          value={title}
          disabled={loading}
          maxLength={NOTE_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Tricky blonde, very talkative"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="ac-note-body">
          Note (only you and other pros they book see this)
        </label>
        <textarea
          id="ac-note-body"
          value={body}
          disabled={loading}
          maxLength={NOTE_BODY_MAX}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Prefers cooler tones, sensitive to strong fragrances."
          className="w-full resize-y rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none focus:border-white/20"
        />
      </div>

      {error ? (
        <div className="text-xs font-semibold text-microAccent">{error}</div>
      ) : null}

      <div className="flex justify-end">
        <button type="submit" disabled={loading} className={addBtn(loading)}>
          {loading ? 'Saving…' : 'Add note'}
        </button>
      </div>
    </form>
  )
}

export default function ClientProfilePanel({
  clientId,
  allergies,
  notes,
}: {
  clientId: string
  allergies: AllergyItem[]
  notes: ClientNoteItem[]
}) {
  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary">
      <div className="text-xs font-black tracking-wide text-textPrimary">
        Client profile (private)
      </div>
      <div className="text-xs font-semibold text-textSecondary">
        Allergies and notes only you and other pros they book can see — never the
        client.
      </div>

      <div className="mt-4">
        <div className={sectionTitleClass}>Allergies &amp; sensitivities</div>
        {allergies.length === 0 ? (
          <div className="mt-2 rounded-card border border-white/10 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
            None recorded yet.
          </div>
        ) : (
          <div className="mt-2 grid gap-2">
            {allergies.map((a) => (
              <div
                key={a.id}
                className="rounded-card border border-white/10 bg-bgPrimary p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-black text-textPrimary">
                    {a.label}
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-[11px] font-black text-textSecondary">
                    {a.severity.toUpperCase()}
                  </span>
                </div>
                {a.description ? (
                  <div className="mt-2 text-xs font-semibold text-textSecondary">
                    {a.description}
                  </div>
                ) : null}
                <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
                  Recorded {formatDate(a.createdAt)}
                  {a.recordedByName ? ` • by ${a.recordedByName}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
        <AllergyForm clientId={clientId} />
      </div>

      <div className="mt-5">
        <div className={sectionTitleClass}>Your notes on this client</div>
        {notes.length === 0 ? (
          <div className="mt-2 rounded-card border border-white/10 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
            No notes yet. Start the “professional memory” file.
          </div>
        ) : (
          <div className="mt-2 grid gap-2">
            {notes.map((n) => (
              <div
                key={n.id}
                className="rounded-card border border-white/10 bg-bgPrimary p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-black text-textPrimary">
                    {n.title || 'Note'}
                  </div>
                  <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                    {formatDate(n.createdAt)}
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-xs font-semibold text-textSecondary">
                  {n.body}
                </div>
              </div>
            ))}
          </div>
        )}
        <NoteForm clientId={clientId} />
      </div>
    </div>
  )
}
