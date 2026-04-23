// app/(main)/booking/AvailabilityDrawer/components/ProCard.tsx
'use client'

import Link from 'next/link'
import type { ProCard as Pro } from '../types'

const PAPER = 'rgba(244,239,231,1)'
const PAPER_DIM = 'rgba(244,239,231,0.5)'
const PAPER_FAINT = 'rgba(244,239,231,0.08)'
const PAPER_BORDER = 'rgba(244,239,231,0.14)'

function initial(name: string) {
  return (name || 'P').slice(0, 1).toUpperCase()
}

export default function ProCard({
  pro,
  statusLine,
  showFallbackActions,
  viewProServicesHref,
  onScrollToOtherPros,
}: {
  pro: Pro
  appointmentTz: string
  viewerTz: string | null
  statusLine: string
  showFallbackActions: boolean
  viewProServicesHref: string
  onScrollToOtherPros: () => void
}) {
  const name = pro.businessName?.trim() || 'Professional'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        paddingBottom: 16,
        borderBottom: '1px solid rgba(244,239,231,0.08)',
      }}
    >
      {/* Avatar */}
      <Link
        href={`/professionals/${encodeURIComponent(pro.id)}`}
        style={{ flexShrink: 0, textDecoration: 'none' }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            overflow: 'hidden',
            background: PAPER_FAINT,
            border: `1px solid ${PAPER_BORDER}`,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {pro.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pro.avatarUrl}
              alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <span style={{ fontSize: 17, fontWeight: 900, color: PAPER_DIM }}>
              {initial(name)}
            </span>
          )}
        </div>
      </Link>

      {/* Name + status */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link
          href={`/professionals/${encodeURIComponent(pro.id)}`}
          style={{ textDecoration: 'none' }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 900,
              color: PAPER,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
        </Link>

        {statusLine ? (
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              fontWeight: 600,
              color: PAPER_DIM,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {statusLine}
          </div>
        ) : null}
      </div>

      {/* Fallback actions (kept for rare cases) */}
      {showFallbackActions ? (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Link
            href={viewProServicesHref}
            style={{
              height: 34,
              padding: '0 14px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 999,
              border: `1px solid ${PAPER_BORDER}`,
              background: PAPER_FAINT,
              fontSize: 12,
              fontWeight: 800,
              color: PAPER,
              textDecoration: 'none',
            }}
          >
            More services
          </Link>
          <button
            type="button"
            onClick={onScrollToOtherPros}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 999,
              border: `1px solid ${PAPER_BORDER}`,
              background: PAPER_FAINT,
              fontSize: 12,
              fontWeight: 800,
              color: PAPER,
              cursor: 'pointer',
            }}
          >
            Other pros
          </button>
        </div>
      ) : null}
    </div>
  )
}
