// app/client/(gated)/settings/ClientChartSharingSettings.tsx
//
// W5 — the client's own control over who can read their chart.
//
// This is the surface the whole feature exists for. Without it the revoke lives
// only behind an API call, which is a capability the client has and cannot
// reach — the same shape of defect as the settings link W3 fixed.
//
// It reads and writes `/api/v1/client/chart-shares`. Revoking is never refused
// server-side, so nothing here needs to guard it.

'use client'

import { useCallback, useEffect, useState } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import Button from '@/app/_components/ui/Button'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'

type ShareStatus = 'REQUESTED' | 'GRANTED' | 'DECLINED' | 'REVOKED'

type ChartShare = {
  professionalId: string
  professionalName: string
  avatarUrl: string | null
  status: ShareStatus
}

function parseStatus(value: unknown): ShareStatus | null {
  return value === 'REQUESTED' ||
    value === 'GRANTED' ||
    value === 'DECLINED' ||
    value === 'REVOKED'
    ? value
    : null
}

function parseShares(payload: unknown): ChartShare[] {
  if (!isRecord(payload) || !Array.isArray(payload.shares)) return []

  const out: ChartShare[] = []
  for (const item of payload.shares) {
    if (!isRecord(item)) continue
    const professionalId =
      typeof item.professionalId === 'string' ? item.professionalId : null
    const status = parseStatus(item.status)
    if (!professionalId || !status) continue

    out.push({
      professionalId,
      professionalName:
        typeof item.professionalName === 'string' && item.professionalName
          ? item.professionalName
          : 'Professional',
      avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
      status,
    })
  }
  return out
}

const STATUS_COPY: Record<ShareStatus, string> = {
  GRANTED: 'Can see your chart',
  REQUESTED: 'Asked to see your chart',
  DECLINED: 'You said no',
  REVOKED: 'You turned this off',
}

export default function ClientChartSharingSettings() {
  const [shares, setShares] = useState<ChartShare[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/v1/client/chart-shares', {
        headers: { Accept: 'application/json' },
      })
      const data = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? 'Failed to load chart sharing.')
      }
      setShares(parseShares(data))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load chart sharing.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(professionalId: string, action: 'GRANT' | 'REVOKE') {
    setBusyId(professionalId)
    setError(null)
    try {
      const res = await fetch('/api/v1/client/chart-shares', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ professionalId, action }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? 'Failed to update chart sharing.')
      }
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update chart sharing.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="text-[13px] font-semibold text-textSecondary">Loading…</div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div className="rounded-inner border border-white/10 bg-bgPrimary/25 p-3 text-[13px] font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      {shares.length === 0 ? (
        <div className="text-[13px] font-semibold text-textSecondary">
          No one has asked to see your chart. Pros you book with can always see
          the record of the work they do for you.
        </div>
      ) : null}

      {shares.map((share) => (
        <div
          key={share.professionalId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-inner border border-white/10 bg-bgPrimary/20 p-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-bgPrimary/45">
              {share.avatarUrl ? (
                <RemoteImage
                  src={share.avatarUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-black text-textPrimary">
                {share.professionalName}
              </div>
              <div className="text-[12px] font-semibold text-textSecondary">
                {STATUS_COPY[share.status]}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {share.status === 'GRANTED' ? (
              <Button
                variant="danger"
                size="sm"
                disabled={busyId === share.professionalId}
                onClick={() => void act(share.professionalId, 'REVOKE')}
              >
                {busyId === share.professionalId ? 'Turning off…' : 'Turn off'}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId === share.professionalId}
                onClick={() => void act(share.professionalId, 'GRANT')}
              >
                {busyId === share.professionalId ? 'Sharing…' : 'Share chart'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
