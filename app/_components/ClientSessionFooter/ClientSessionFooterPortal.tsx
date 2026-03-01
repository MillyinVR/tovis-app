// app/_components/ClientSessionFooter/ClientSessionFooterPortal.tsx
'use client'

import ClientSessionFooter from './ClientSessionFooter'
import { FooterPortal } from '@/app/_components/FooterPortal'

export default function ClientSessionFooterPortal({ messagesBadge }: { messagesBadge?: string | null }) {
  return (
    <FooterPortal>
      <div style={{ pointerEvents: 'auto', width: '100%' }}>
        <ClientSessionFooter messagesBadge={messagesBadge ?? null} />
      </div>
    </FooterPortal>
  )
}