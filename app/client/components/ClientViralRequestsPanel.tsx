// app/client/components/ClientViralRequestsPanel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

import type { ViralRequestDto } from '@/lib/viralRequests/contracts'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJsonRecord } from '@/lib/http'

const VIRAL_REQUEST_STATUSES = [
  'REQUESTED',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
] as const satisfies readonly ViralRequestDto['status'][]

const MODERATION_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'REMOVED',
  'AUTO_FLAGGED',
] as const satisfies readonly ViralRequestDto['moderationStatus'][]

const VIRAL_REQUEST_STATUS_SET: ReadonlySet<string> = new Set(
  VIRAL_REQUEST_STATUSES,
)

const MODERATION_STATUS_SET: ReadonlySet<string> = new Set(
  MODERATION_STATUSES,
)

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function isViralRequestStatus(
  value: unknown,
): value is ViralRequestDto['status'] {
  return typeof value === 'string' && VIRAL_REQUEST_STATUS_SET.has(value)
}

function isModerationStatus(
  value: unknown,
): value is ViralRequestDto['moderationStatus'] {
  return typeof value === 'string' && MODERATION_STATUS_SET.has(value)
}

function parseRequestedCategory(
  value: unknown,
): ViralRequestDto['requestedCategory'] {
  if (!isRecord(value)) return null

  const id = readTrimmedString(value.id)
  const name = readTrimmedString(value.name)
  const slug = readTrimmedString(value.slug)

  if (!id || !name || !slug) return null

  return {
    id,
    name,
    slug,
  }
}

function parseViralRequestDto(value: unknown): ViralRequestDto | null {
  if (!isRecord(value)) return null

  const id = readTrimmedString(value.id)
  const name = readTrimmedString(value.name)
  const status = value.status
  const moderationStatus = value.moderationStatus
  const createdAt = readTrimmedString(value.createdAt)
  const updatedAt = readTrimmedString(value.updatedAt)

  if (
    !id ||
    !name ||
    !isViralRequestStatus(status) ||
    !isModerationStatus(moderationStatus) ||
    !createdAt ||
    !updatedAt
  ) {
    return null
  }

  return {
    id,
    name,
    description: readTrimmedString(value.description),
    sourceUrl: readTrimmedString(value.sourceUrl),
    links: readStringArray(value.links),
    mediaUrls: readStringArray(value.mediaUrls),
    requestedCategoryId: readTrimmedString(value.requestedCategoryId),
    requestedCategory: parseRequestedCategory(value.requestedCategory),
    status,
    moderationStatus,
    reviewedAt: readTrimmedString(value.reviewedAt),
    reviewedByUserId: readTrimmedString(value.reviewedByUserId),
    approvedAt: readTrimmedString(value.approvedAt),
    rejectedAt: readTrimmedString(value.rejectedAt),
    adminNotes: readTrimmedString(value.adminNotes),
    createdAt,
    updatedAt,
  }
}

function parseRequestsPayload(data: unknown): ViralRequestDto[] {
  if (!isRecord(data) || !Array.isArray(data.requests)) return []

  return data.requests
    .map(parseViralRequestDto)
    .filter((request): request is ViralRequestDto => request !== null)
}

function parseCreatedRequest(data: unknown): ViralRequestDto | null {
  if (!isRecord(data)) return null
  return parseViralRequestDto(data.request)
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString()
}

function getStatusLabel(status: ViralRequestDto['status']): string {
  switch (status) {
    case 'APPROVED':
      return 'Approved'
    case 'REJECTED':
      return 'Denied'
    case 'IN_REVIEW':
      return 'In review'
    case 'REQUESTED':
    default:
      return 'Requested'
  }
}

function getStatusTone(status: ViralRequestDto['status']): string {
  switch (status) {
    case 'APPROVED':
      return 'text-toneSuccess'
    case 'REJECTED':
      return 'text-toneDanger'
    case 'IN_REVIEW':
      return 'text-accentPrimary'
    case 'REQUESTED':
    default:
      return 'text-toneWarn'
  }
}

export default function ClientViralRequestsPanel() {
  const [requests, setRequests] = useState<ViralRequestDto[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  const loadRequests = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/viral-service-requests?take=20', {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
        signal,
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        throw new Error(
          readErrorMessage(data) ?? 'Couldn’t load viral requests. Try again.',
        )
      }

      setRequests(parseRequestsPayload(data))
    } catch (loadError: unknown) {
      if (isAbortError(loadError)) return

      setError(
        loadError instanceof Error && loadError.message.trim()
          ? loadError.message
          : 'Couldn’t load viral requests. Try again.',
      )
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadRequests(controller.signal)
    return () => controller.abort()
  }, [loadRequests])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) return

    const trimmedName = name.trim()
    const trimmedSourceUrl = sourceUrl.trim()

    setNotice(null)
    setError(null)

    if (!trimmedName) {
      setError('Please enter a viral service name.')
      return
    }

    try {
      setSubmitting(true)

      const res = await fetch('/api/viral-service-requests', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          sourceUrl: trimmedSourceUrl || undefined,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        throw new Error(
          readErrorMessage(data) ?? 'Couldn’t create viral request. Try again.',
        )
      }

      const created = parseCreatedRequest(data)

      if (created) {
        setRequests((current) => [
          created,
          ...current.filter((item) => item.id !== created.id),
        ])
      } else {
        await loadRequests()
      }

      setName('')
      setSourceUrl('')
      setNotice('Viral request submitted — admin will review it.')
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error && submitError.message.trim()
          ? submitError.message
          : 'Couldn’t create viral request. Try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4">
      {notice ? (
        <div className="rounded-inner border border-toneSuccess/25 bg-toneSuccess/8 px-4 py-3 text-sm font-semibold text-toneSuccess">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-inner border border-toneDanger/25 bg-toneDanger/8 px-4 py-3 text-sm font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-2 sm:grid-cols-3">
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder='Service name (e.g. "Wolf Cut")'
          disabled={submitting}
          className="w-full rounded-inner border border-textPrimary/10 bg-bgSecondary px-3 py-2.5 text-sm text-textPrimary outline-none transition placeholder:text-textSecondary/50 focus:border-accentPrimary/30 focus:ring-1 focus:ring-accentPrimary/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          name="sourceUrl"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="TikTok / IG / YouTube link — optional"
          disabled={submitting}
          className="w-full rounded-inner border border-textPrimary/10 bg-bgSecondary px-3 py-2.5 text-sm text-textPrimary outline-none transition placeholder:text-textSecondary/50 focus:border-accentPrimary/30 focus:ring-1 focus:ring-accentPrimary/20 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
        />

        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-inner border border-textPrimary/10 bg-bgSecondary px-4 py-2 text-sm font-bold text-textPrimary transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-textSecondary/60">
          Loading viral requests…
        </p>
      ) : requests.length > 0 ? (
        <div className="grid gap-2">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between gap-3 rounded-inner border border-textPrimary/8 bg-bgSecondary px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{request.name}</div>
                <div className="mt-0.5 text-[11px] text-textSecondary">
                  {formatCreatedAt(request.createdAt)}
                  {request.sourceUrl ? (
                    <>
                      {' · '}
                      <a
                        className="underline underline-offset-2"
                        href={request.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        link
                      </a>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`text-[11px] font-black ${getStatusTone(request.status)}`}
                >
                  {getStatusLabel(request.status)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-textSecondary/60">No requests yet.</p>
      )}
    </div>
  )
}