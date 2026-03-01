// app/_components/ClientSessionFooter/BadgeDot.tsx
'use client'

export default function BadgeDot({ label }: { label: string }) {
  const text = String(label ?? '').trim()
  if (!text) return null

  return (
    <span
      className={[
        'pointer-events-none',
        'inline-flex items-center justify-center',
        'h-4 min-w-4 px-1.5',
        'rounded-full',
        'border border-accentPrimary/35 bg-accentPrimary/12',
        'text-[10px] font-black leading-none text-accentPrimary',
      ].join(' ')}
      role="status"
      aria-label={`${text} unread`}
      title="Unread"
    >
      {text}
    </span>
  )
}