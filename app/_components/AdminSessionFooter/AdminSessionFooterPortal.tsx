// app/_components/AdminSessionFooter/AdminSessionFooterPortal.tsx
'use client'

import AdminSessionFooter from './AdminSessionFooter'
import { FooterPortal } from '@/app/_components/FooterPortal'

export default function AdminSessionFooterPortal({ supportBadge }: { supportBadge?: string | null }) {
  return (
    <FooterPortal>
      <div style={{ pointerEvents: 'auto', width: '100%' }}>
        <AdminSessionFooter supportBadge={supportBadge ?? null} />
      </div>
    </FooterPortal>
  )
}