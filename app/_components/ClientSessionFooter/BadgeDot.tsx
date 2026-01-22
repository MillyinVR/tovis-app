// app/_components/ClientSessionFooter/BadgeDot.tsx
'use client'

export default function BadgeDot({ label }: { label: string }) {
  return (
    <span
      className="border border-accentPrimary/35 bg-accentPrimary/12 text-accentPrimary"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 16,
        padding: '0 6px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 900,
        lineHeight: 1,
      }}
      title="Unread"
    >
      {label}
    </span>
  )
}
