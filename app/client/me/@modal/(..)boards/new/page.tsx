// app/client/me/@modal/(..)boards/new/page.tsx
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import CreateBoardForm from '@/app/client/boards/_components/CreateBoardForm'
import { createBoardAction } from '@/app/client/boards/_actions/createBoard'
import DismissModalButton from '../../_components/DismissModalButton'

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

export default async function ClientNewBoardModalPage(props: {
  searchParams?: PageSearchParams | Promise<PageSearchParams>
}) {
  await requireAuthedClientUser()

  const searchParams = await resolveSearchParams(props.searchParams)
  const errorMessage = normalizeErrorMessage(searchParams.error)

  return (
    <div className="fixed inset-0 z-50">
      <DismissModalButton
        ariaLabel="Close create board modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <div className="pointer-events-none relative z-10 flex min-h-full items-end justify-center px-4 pb-2 pt-2 sm:items-center sm:p-4">
        <div
          className="
            pointer-events-auto flex w-full max-w-lg flex-col
            rounded-card border border-white/10 bg-bgSecondary
            shadow-[0_24px_80px_rgba(0,0,0,0.45)]
            h-[min(760px,calc(100dvh-0.5rem))]
            overflow-hidden
          "
        >
          <div className="shrink-0 border-b border-white/10 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-textSecondary/60">
                  Boards
                </div>
                <h1 className="mt-1 text-[20px] font-bold leading-tight text-textPrimary">
                  Create new board
                </h1>
                <p className="mt-1 text-[13px] text-textSecondary">
                  Save your favorite looks in one place.
                </p>
              </div>

              <DismissModalButton
                ariaLabel="Close"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-bgPrimary text-textSecondary transition hover:border-white/20 hover:text-textPrimary"
              >
                ×
              </DismissModalButton>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-y-contain [webkit-overflow-scrolling:touch]">
            <CreateBoardForm
              action={createBoardAction}
              errorMessage={errorMessage}
              cancelHref="/client/me"
              className="border-0 bg-transparent p-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}