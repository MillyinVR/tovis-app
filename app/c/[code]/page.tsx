// app/c/[code]/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { normalizeShortCode } from '@/lib/nfcShortCode'
import { isNfcTapWithinRateLimit } from '@/lib/nfc/tapRateLimit'

export default async function CodeRedirectPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params

  // Short codes are hand-typed and the enumeration vector, so they get a tighter
  // per-IP rate limit than a direct card tap. The downstream /t route applies
  // its own limit on top.
  if (!(await isNfcTapWithinRateLimit('nfc:code'))) {
    redirect('/nfc/invalid?reason=rate')
  }

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
