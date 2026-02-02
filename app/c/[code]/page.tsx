// app/c/[code]/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { normalizeShortCode } from '@/lib/nfcShortCode'

export default async function CodeRedirectPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params
  const normalized = normalizeShortCode(code)

  if (!normalized) {
    redirect('/nfc/invalid')
  }

  const card = await prisma.nfcCard.findUnique({
    where: { shortCode: normalized },
    select: { id: true, isActive: true },
  })

  if (!card || !card.isActive) {
    redirect('/nfc/invalid')
  }

  redirect(`/t/${card.id}`)
}
