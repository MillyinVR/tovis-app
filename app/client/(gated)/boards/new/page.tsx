// app/client/boards/new/page.tsx
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import ClientPage from '../../_components/ClientPage'
import CreateBoardForm from '../_components/CreateBoardForm'
import { createBoardAction } from '../_actions/createBoard'

export const dynamic = 'force-dynamic'

type PageSearchParams = Record<string, string | string[] | undefined>

type MaybeCurrentUser = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<MaybeCurrentUser> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

function isAuthedClientUser(
  user: MaybeCurrentUser | null,
): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

async function requireAuthedClientUser(): Promise<AuthedClientUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isAuthedClientUser(user)) {
    redirect('/login?from=/client/boards/new')
  }

  return user
}

async function resolveSearchParams(
  value: PageSearchParams | Promise<PageSearchParams> | undefined,
): Promise<PageSearchParams> {
  if (!value) return {}
  return Promise.resolve(value)
}

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

function normalizeErrorMessage(
  value: string | string[] | undefined,
): string | null {
  const message = firstSearchParam(value)?.trim()
  return message ? message : null
}

export default async function ClientNewBoardPage(props: {
  searchParams?: PageSearchParams | Promise<PageSearchParams>
}) {
  await requireAuthedClientUser()

  const searchParams = await resolveSearchParams(props.searchParams)
  const errorMessage = normalizeErrorMessage(searchParams.error)

  return (
    <ClientPage
      eyebrow="Boards"
      title="Create new board"
      lede="Save your favorite looks in one place so they’re easy to find later."
      back={{ href: '/client/me', label: 'Me' }}
    >
      <CreateBoardForm
        action={createBoardAction}
        errorMessage={errorMessage}
        cancelHref="/client/me"
      />
    </ClientPage>
  )
}