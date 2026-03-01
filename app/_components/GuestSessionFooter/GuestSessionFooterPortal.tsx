// app/_components/GuestSessionFooter/GuestSessionFooterPortal.tsx
'use client'

import GuestSessionFooter from './GuestSessionFooter'
import { FooterPortal } from '@/app/_components/FooterPortal'

export default function GuestSessionFooterPortal() {
  return (
    <FooterPortal>
      <div style={{ pointerEvents: 'auto', width: '100%' }}>
        <GuestSessionFooter />
      </div>
    </FooterPortal>
  )
}