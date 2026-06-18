// app/_components/ClientSessionFooter/BadgeDot.tsx
'use client'

export default function BadgeDot({ label }: { label: string }) {
  const text = String(label ?? '').trim()
  if (!text) return null

  return (
    <span
      style={{
        pointerEvents: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        minWidth: 16,
        padding: '0 5px',
        borderRadius: 999,
        background: 'rgb(var(--accent-primary))',
        color: 'rgb(var(--on-accent))',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
      }}
      role="status"
      aria-label={`${text} unread`}
      title="Unread"
    >
      {text}
    </span>
  )
}
