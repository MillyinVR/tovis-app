'use client'

// app/pro/viral-requests/ViralRequestLibrary.tsx
//
// The list, and the one control that matters: "I can do this".
//
// Optimistic, but never silently. The row flips the moment it is tapped so the
// answer feels instant, and if the write fails the row flips BACK and says so —
// a control that keeps a state the server rejected is how a pro ends up
// believing they are listed for a look they are not.
//
// The server's response replaces the row wholesale rather than being merged,
// because `offeringProCount` moves too and only the server knows its new value.

import { useCallback, useState } from 'react'

import type { ProViralRequestDTO } from '@/lib/dto/proViralRequests'

function platformLabel(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, '')
    if (host.endsWith('tiktok.com')) return 'TikTok'
    if (host.endsWith('instagram.com')) return 'Instagram'
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube'
    if (host.endsWith('pinterest.com')) return 'Pinterest'
    return host
  } catch {
    // A stored value that no longer parses is not worth a crash on a list page.
    return null
  }
}

export default function ViralRequestLibrary({
  initialRequests,
}: {
  initialRequests: ProViralRequestDTO[]
}) {
  const [requests, setRequests] = useState(initialRequests)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const replace = useCallback((next: ProViralRequestDTO) => {
    setRequests((rows) => rows.map((r) => (r.id === next.id ? next : r)))
  }, [])

  const toggle = useCallback(
    async (request: ProViralRequestDTO) => {
      const wasOffering = request.offering
      setPendingId(request.id)
      setError(null)

      // Optimistic: flip the row and nudge the count in the same direction the
      // server will, so the number does not visibly lag the toggle.
      replace({
        ...request,
        offering: !wasOffering,
        offeringProCount: Math.max(
          0,
          request.offeringProCount + (wasOffering ? -1 : 1),
        ),
      })

      try {
        const res = await fetch(
          `/api/v1/pro/viral-requests/${encodeURIComponent(request.id)}/offer`,
          { method: wasOffering ? 'DELETE' : 'POST' },
        )
        const body = await res.json().catch(() => null)

        if (!res.ok || !body?.request) {
          // Put the row back exactly as it was, then say what happened.
          replace(request)
          setError(
            wasOffering
              ? 'Could not remove you from that look. Please try again.'
              : 'Could not add you to that look. Please try again.',
          )
          return
        }

        replace(body.request as ProViralRequestDTO)
      } catch {
        replace(request)
        setError('Something went wrong. Please try again.')
      } finally {
        setPendingId(null)
      }
    },
    [replace],
  )

  if (requests.length === 0) {
    return (
      <p className="rounded-card border border-textPrimary/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
        Nothing yet. When a client asks for a look that matches one of your
        services, it will show up here.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="text-[12px] font-bold text-toneDanger">
          {error}
        </p>
      ) : null}

      <ul className="grid gap-3">
        {requests.map((request) => {
          const platform = platformLabel(request.sourceUrl)
          const busy = pendingId === request.id

          return (
            <li
              key={request.id}
              className="grid gap-2 rounded-card border border-textPrimary/10 bg-bgSecondary p-4"
            >
              <div className="grid gap-1">
                <h2 className="text-[15px] font-black text-textPrimary">
                  {request.name}
                </h2>
                <p className="text-[12px] font-semibold text-textSecondary">
                  {[
                    request.categoryName,
                    platform,
                    request.offeringProCount === 1
                      ? '1 pro offers this'
                      : `${request.offeringProCount} pros offer this`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void toggle(request)}
                disabled={busy}
                aria-pressed={request.offering}
                className={[
                  'brand-focus justify-self-start rounded-full px-4 py-2 text-[12px] font-black transition disabled:opacity-60',
                  request.offering
                    ? 'bg-toneSuccess/15 text-toneSuccess'
                    : 'bg-accentPrimary text-onAccent',
                ].join(' ')}
              >
                {request.offering ? 'You offer this' : 'I can do this'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
