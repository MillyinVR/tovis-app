// app/client/boards/new/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
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
    <main
      className="mx-auto w-full max-w-2xl px-4 pb-24 text-textPrimary"
      style={{
        paddingTop: 'max(48px, env(safe-area-inset-top, 0px) + 24px)',
      }}
    >
      <header className="mb-6 border-b border-white/10 pb-5">
        <Link
          href="/client/me"
          className="inline-flex items-center text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
        >
          ← Back to Me
        </Link>

        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-textSecondary/60">
            Boards
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold italic leading-tight text-textPrimary">
            Create new board
          </h1>
          <p className="mt-2 text-[13px] text-textSecondary">
            Save your favorite looks in one place so they’re easy to find later.
          </p>
        </div>
      </header>

      <CreateBoardForm
        action={createBoardAction}
        errorMessage={errorMessage}
        cancelHref="/client/me"
      />
    </main>
  )
}