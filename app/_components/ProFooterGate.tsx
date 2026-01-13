// app/_components/ProFooterGate.tsx
'use client'

import ProSessionFooterPortal from '@/app/pro/_components/ProSessionFooter/ProSessionFooterPortal'

type ProFooterGateProps = {
  isPro: boolean
}

export default function ProFooterGate({ isPro }: ProFooterGateProps) {
  if (!isPro) return null
  return <ProSessionFooterPortal />
}
