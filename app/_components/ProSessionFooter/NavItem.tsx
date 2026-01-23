// app/_components/ProSessionFooter/NavItem.tsx
'use client'

import Link from 'next/link'

export default function NavItem({
  label,
  href,
  icon,
  active,
}: {
  label: string
  href: string
  icon: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={[
        'flex w-18 flex-col items-center justify-center gap-1',
        'text-[11px] font-extrabold',
        active ? 'text-textPrimary' : 'text-textSecondary',
        'no-underline',
      ].join(' ')}
    >
      <span className={['text-[18px]', active ? '' : 'opacity-80'].join(' ')}>{icon}</span>
      <span className={active ? '' : 'opacity-80'}>{label}</span>
      {active ? (
        <span className="-mt-0.5 h-0.5 w-6 rounded-full bg-white/40" />
      ) : (
        <span className="h-0.5 w-6" />
      )}
    </Link>
  )
}
