'use client'

import type { ReactNode } from 'react'

export function PanelShell({ children }: { children: ReactNode }) {
  return (
    <section className="w-full max-w-130 rounded-2xl border border-white/10 bg-bgPrimary p-4 text-textPrimary">
      {children}
    </section>
  )
}
