// app/pro/profile/public-profile/page.tsx
import ProProfileManagementShell from './_components/ProProfileManagementShell'
import { loadProProfileManagementPage } from './_data/loadProProfileManagementPage'
import type { ProProfileManagementSearchParams } from './_data/proProfileManagementTypes'

export const dynamic = 'force-dynamic'

export default async function ProPublicProfilePage({
  searchParams,
}: {
  searchParams: Promise<ProProfileManagementSearchParams>
}) {
  const model = await loadProProfileManagementPage({
    searchParams: await searchParams,
  })

  return <ProProfileManagementShell model={model} />
}