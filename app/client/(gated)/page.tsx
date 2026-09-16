// app/client/page.tsx
import { redirect } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

import ClientHomeShell from './_components/ClientHomeShell'
import { getClientHomeData } from './_data/getClientHomeData'
import { requireClientPage } from './_data/requireClientPage'

export const dynamic = 'force-dynamic'

const CLIENT_HOME = '/client'

/** This page's gate — now the shared one, so a new gated page inherits it. */
function requireClientOrRedirect() {
  return requireClientPage(CLIENT_HOME)
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
  const user = await requireClientOrRedirect()
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  const userId = user.id
  const clientId = user.clientProfile.id
  // The greeting name comes from the loader, not from a local pick, so the web
  // page and GET /api/v1/client/home cannot greet the same client differently.
  const home = await getClientHomeData({ clientId, userId })

  return (
    <ClientHomeShell
      brandText={brand.assets.wordmark.text}
      brandName={brand.displayName}
      displayName={home.displayName}
      home={home}
      removeProFavoriteAction={removeProFavoriteAction}
    />
  )
}