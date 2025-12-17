// app/pro/notifications/NotificationsHeader.tsx
'use client'

import { useRouter } from 'next/navigation'

export default function NotificationsHeader({
  unreadCount,
}: {
  unreadCount: number
}) {
  const router = useRouter()
  const hasUnread = unreadCount > 0

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0 12px',
      }}
    >
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.back()}
        style={{
          border: 'none',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          fontSize: 13,
          color: '#111',
        }}
      >
        <span style={{ fontSize: 18 }}>‹</span>
        <span>Back</span>
      </button>

      <div style={{ fontSize: 15, fontWeight: 600 }}>Notifications</div>

      {/* Bell */}
      <button
        type="button"
        style={{
          border: 'none',
          background: 'transparent',
          position: 'relative',
          cursor: 'default',
        }}
      >
        <span style={{ fontSize: 18 }}>🔔</span>
        {hasUnread && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#ef4444',
              border: '1px solid #fff',
            }}
          />
        )}
      </button>
    </div>
  )
}
