// app/_components/ProSessionFooter/ProSessionFooterPortal.tsx
'use client'

import ProSessionFooter from './ProSessionFooter'
import { FooterPortal } from '@/app/_components/FooterPortal'

export default function ProSessionFooterPortal({ messagesBadge }: { messagesBadge?: string | null }) {
  return (
    <FooterPortal>
      <div style={{ pointerEvents: 'auto', width: '100%' }}>
        <ProSessionFooter messagesBadge={messagesBadge ?? null} />
      </div>
    </FooterPortal>
  )
}