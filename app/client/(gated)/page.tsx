// app/client/page.tsx
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getBrandConfig } from '@/lib/brand'

import ClientHomeShell from './_components/ClientHomeShell'
import { getClientHomeData } from './_data/getClientHomeData'

export const dynamic = 'force-dynamic'

type MaybeCurrentUser = Awaited<ReturnType<typeof getCurrentUser>>
type CurrentUser = NonNullable<MaybeCurrentUser>

type ClientPageUser = CurrentUser & {
  role: 'CLIENT'
  clientProfile: NonNullable<CurrentUser['clientProfile']>
}

function isClientPageUser(user: MaybeCurrentUser): user is ClientPageUser {
  return Boolean(user && user.role === Role.CLIENT && user.clientProfile?.id)
}

function pickDisplayName(user: ClientPageUser): string {
  const firstName = (user.clientProfile.firstName ?? '').trim()
  const email = (user.email ?? '').trim()

  return firstName || email || 'there'
}

async function requireClientOrRedirect(): Promise<ClientPageUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isClientPageUser(user)) {
    redirect('/login?from=/client')
  }

  return user
}

async function removeProFavoriteAction(formData: FormData) {
  'use server'

  const user = await requireClientOrRedirect()

  const professionalId = String(formData.get('professionalId') ?? '').trim()

  if (!professionalId) {
    redirect('/client')
  }

  await prisma.professionalFavorite.deleteMany({
    where: {
      professionalId,
      userId: user.id,
    },
  })

  redirect('/client')
}

export default async function ClientHomePage() {
  const brand = getBrandConfig()
  const user = await requireClientOrRedirect()

  const userId = user.id
  const clientId = user.clientProfile.id
  const displayName = pickDisplayName(user)

  const home = await getClientHomeData({ clientId, userId })

  return (
    <ClientHomeShell
      brandText={brand.assets.wordmark.text}
      displayName={displayName}
      home={home}
      removeProFavoriteAction={removeProFavoriteAction}
    />
  )
}