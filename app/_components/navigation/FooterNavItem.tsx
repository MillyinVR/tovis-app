// app/_components/navigation/FooterNavItem.tsx
'use client'

import Link from 'next/link'

/**
 * Bottom-nav item on the new Tovis surface footer.
 * Active = accent icon + full-strength label + a small accent dot above.
 * Inactive = muted. (No more heavy text-shadow — the bar sits on the surface
 * token, not over media.)
 */
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
      className="no-underline tovis-focus"
      style={{
        display: 'grid',
        gap: 4,
        justifyItems: 'center',
        position: 'relative',
        padding: '0 6px',
        color: active ? 'rgb(var(--text-primary))' : 'rgb(var(--text-muted))',
      }}
    >
      {active ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -9,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'rgb(var(--accent-primary))',
          }}
        />
      ) : null}

      <span style={{ position: 'relative', display: 'flex' }}>
        <span
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: active ? 'rgb(var(--accent-primary))' : 'inherit',
          }}
        >
          {icon}
        </span>
        {rightSlot ? (
          <span style={{ position: 'absolute', right: -8, top: -6 }}>
            {rightSlot}
          </span>
        ) : null}
      </span>

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </Link>
  )
}
