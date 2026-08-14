'use client'

import { useCallback, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * The pro authoring "Before you go" — the checklist their client sees in the
 * days before an appointment, plus the note beside it.
 *
 * ONE component, BOTH scopes. Mounted with no `offeringId` it edits the pro's
 * default list; mounted with one it edits that service's own list, which
 * REPLACES the default rather than adding to it. The copy says which, because
 * "replaces" is the part a pro will otherwise get wrong.
 */

type Props = {
  /** Omit for the pro's default list. */
  offeringId?: string
  /** Shown in the copy so the pro knows which list they are editing. */
  serviceName?: string
}

type Item = { key: string; text: string }

let keySeq = 0
const nextKey = () => `row-${(keySeq += 1)}`

export default function PrepChecklistEditor({ offeringId, serviceName }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [note, setNote] = useState('')
  const [defaultNote, setDefaultNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const endpoint = offeringId
    ? `/api/v1/pro/prep?offeringId=${encodeURIComponent(offeringId)}`
    : '/api/v1/pro/prep'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(endpoint)
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean
          items?: { id: string; text: string }[]
          note?: string | null
          defaultNote?: string | null
        } | null
        if (cancelled) return
        if (!res.ok || !body?.ok) {
          setError('Could not load your checklist.')
          return
        }
        setItems((body.items ?? []).map((row) => ({ key: nextKey(), text: row.text })))
        setNote(body.note ?? '')
        setDefaultNote(body.defaultNote ?? null)
      } catch {
        if (!cancelled) setError('Could not load your checklist.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [endpoint])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((i) => i.text), note }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        items?: { id: string; text: string }[]
      } | null
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? 'Could not save your checklist.')
        return
      }
      setItems((body.items ?? []).map((row) => ({ key: nextKey(), text: row.text })))
      setStatus('Saved.')
    } catch {
      setError('Could not save your checklist.')
    } finally {
      setSaving(false)
    }
  }, [endpoint, items, note])

  const overridesDefault = Boolean(offeringId) && items.length > 0

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgPrimary p-4">
      <h3 className="text-[14px] font-black text-textPrimary">Before you go</h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-textSecondary">
        {offeringId
          ? `What a client should do before ${serviceName ? `a ${serviceName}` : 'this service'}. Anything here REPLACES your default checklist for this service — leave it empty to use the default.`
          : 'What a client should do before any appointment with you. A service can override this with its own list.'}
      </p>

      {loading ? (
        <p className="mt-3 text-[12px] font-semibold text-textSecondary">Loading…</p>
      ) : (
        <>
          {overridesDefault ? (
            <p className="mt-3 rounded-[10px] border border-toneWarn/30 px-3 py-2 text-[11px] font-semibold text-textPrimary">
              This service uses the list below instead of your default one.
            </p>
          ) : null}

          <ul className="mt-3 flex flex-col gap-2">
            {items.map((item, index) => (
              <li key={item.key} className="flex items-center gap-2">
                <input
                  value={item.text}
                  onChange={(e) => {
                    const next = items.slice()
                    next[index] = { ...item, text: e.target.value }
                    setItems(next)
                  }}
                  placeholder="Arrive with clean, dry hair."
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-[10px] border border-textPrimary/15 bg-transparent px-3 py-2 text-[13px] text-textPrimary outline-none focus:border-accentPrimary"
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                  aria-label={`Remove row ${index + 1}`}
                  className="rounded-[10px] border border-textPrimary/15 px-2 py-2 text-[12px] font-bold text-textSecondary transition hover:border-toneDanger hover:text-toneDanger"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {items.length < 12 ? (
            <button
              type="button"
              onClick={() => setItems([...items, { key: nextKey(), text: '' }])}
              className="mt-2 rounded-[10px] border border-textPrimary/15 px-3 py-2 text-[12px] font-bold text-textPrimary transition hover:border-textPrimary/35"
            >
              + Add a row
            </button>
          ) : (
            <p className="mt-2 text-[11px] font-semibold text-textSecondary">
              That&rsquo;s the most a client will read.
            </p>
          )}

          <label className="mt-4 block">
            <span className="text-[12px] font-black text-textPrimary">
              Note from you
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={
                defaultNote && offeringId
                  ? `Leave empty to use your default: “${defaultNote}”`
                  : 'Plan for about three hours in the chair…'
              }
              className="mt-1 w-full rounded-[10px] border border-textPrimary/15 bg-transparent px-3 py-2 text-[13px] text-textPrimary outline-none focus:border-accentPrimary"
            />
          </label>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={cn(
                'rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-onAccent transition',
                saving ? 'opacity-60' : 'hover:bg-accentPrimaryHover',
              )}
            >
              {saving ? 'Saving…' : 'Save checklist'}
            </button>
            {status ? (
              <span role="status" className="text-[12px] font-semibold text-toneSuccess">
                {status}
              </span>
            ) : null}
            {error ? (
              <span role="status" className="text-[12px] font-semibold text-toneDanger">
                {error}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
