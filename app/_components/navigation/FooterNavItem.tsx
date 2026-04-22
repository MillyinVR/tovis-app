// app/_components/navigation/FooterNavItem.tsx
'use client'

import Link from 'next/link'

export default function NavItem({
  label,
  href,
  icon,
  active,
  rightSlot,
}: {
  label: string
  href: string
  icon: React.ReactNode
  active?: boolean
  rightSlot?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="no-underline"
      style={{
        display: 'grid',
        gap: 2,
        justifyItems: 'center',
        color: active ? 'rgba(244,239,231,1)' : 'rgba(122,117,105,1)',
        textShadow: '0 2px 12px rgba(0,0,0,0.8)',
        position: 'relative',
      }}
    >
      <div className="relative">
        <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </span>
        {rightSlot ? <span className="absolute -right-2 -top-2">{rightSlot}</span> : null}
      </div>

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </Link>
  )
}