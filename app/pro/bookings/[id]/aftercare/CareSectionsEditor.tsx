'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The pro writing the labelled blocks of a client's care plan.
 *
 * 🔴 The HEADING is the pro's own text (Tori, 2026-08-14: the app is for all
 * beauty pros, not just hairstylists). The chips below are starting points
 * drawn from `careSectionSuggestions` for THIS pro's profession — a colourist
 * is offered "Wash", a nail tech "Cuticle oil" — and nothing validates against
 * them. A pro can ignore every chip and type their own heading.
 */

type Props = { bookingId: string }

type Section = { key: string; label: string; body: string }

let keySeq = 0
const nextKey = () => `sec-${(keySeq += 1)}`

export default function CareSectionsEditor({ bookingId }: Props) {
  const [sections, setSections] = useState<Section[]>([])
  const [suggested, setSuggested] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const endpoint = `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}/care-sections`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(endpoint)
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean
          sections?: { label: string; body: string }[]
          suggestedLabels?: string[]
        } | null
        if (cancelled) return
        if (!res.ok || !body?.ok) {
          setError('Could not load the care plan.')
          return
        }
        setSections(
          (body.sections ?? []).map((s) => ({
            key: nextKey(),
            label: s.label,
            body: s.body,
          })),
        )
        setSuggested(body.suggestedLabels ?? [])
      } catch {
        if (!cancelled) setError('Could not load the care plan.')
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
        body: JSON.stringify({
          sections: sections.map((s) => ({ label: s.label, body: s.body })),
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        sections?: { label: string; body: string }[]
      } | null
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? 'Could not save the care plan.')
        return
      }
      setSections(
        (body.sections ?? []).map((s) => ({
          key: nextKey(),
          label: s.label,
          body: s.body,
        })),
      )
      setStatus('Saved.')
    } catch {
      setError('Could not save the care plan.')
    } finally {
      setSaving(false)
    }
  }, [endpoint, sections])

  const addSection = (label: string) =>
    setSections((prev) => [...prev, { key: nextKey(), label, body: '' }])

  const unusedSuggestions = suggested.filter(
    (label) => !sections.some((s) => s.label.trim() === label),
  )

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgPrimary p-4">
      <h3 className="text-[14px] font-black text-textPrimary">Your plan for them</h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-textSecondary">
        What this client should do now, in your own words. Each block gets a
        heading you choose.
      </p>

      {loading ? (
        <p className="mt-3 text-[12px] font-semibold text-textSecondary">Loading…</p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-3">
            {sections.map((section, index) => (
              <div
                key={section.key}
                className="rounded-[12px] border border-textPrimary/10 p-3"
              >
                <div className="flex items-center gap-2">
                  <input
                    value={section.label}
                    onChange={(e) => {
                      const next = sections.slice()
                      next[index] = { ...section, label: e.target.value }
                      setSections(next)
                    }}
                    placeholder="Heading"
                    maxLength={60}
                    className="min-w-0 flex-1 rounded-[8px] border border-textPrimary/15 bg-transparent px-2 py-1.5 text-[13px] font-black text-textPrimary outline-none focus:border-accentPrimary"
                  />
                  <button
                    type="button"
                    onClick={() => setSections(sections.filter((_, i) => i !== index))}
                    aria-label={`Remove ${section.label || `section ${index + 1}`}`}
                    className="rounded-[8px] border border-textPrimary/15 px-2 py-1.5 text-[12px] font-bold text-textSecondary transition hover:border-toneDanger hover:text-toneDanger"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={section.body}
                  onChange={(e) => {
                    const next = sections.slice()
                    next[index] = { ...section, body: e.target.value }
                    setSections(next)
                  }}
                  rows={3}
                  maxLength={1500}
                  placeholder="What they should actually do."
                  className="mt-2 w-full rounded-[8px] border border-textPrimary/15 bg-transparent px-2 py-1.5 text-[13px] text-textPrimary outline-none focus:border-accentPrimary"
                />
              </div>
            ))}
          </div>

          {sections.length < 8 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {unusedSuggestions.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => addSection(label)}
                  className="rounded-full border border-textPrimary/15 px-3 py-1.5 text-[11px] font-bold text-textSecondary transition hover:border-accentPrimary hover:text-textPrimary"
                >
                  + {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => addSection('')}
                className="rounded-full border border-textPrimary/25 px-3 py-1.5 text-[11px] font-bold text-textPrimary transition hover:border-textPrimary/45"
              >
                + Your own heading
              </button>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-onAccent transition hover:bg-accentPrimaryHover disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save plan'}
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
