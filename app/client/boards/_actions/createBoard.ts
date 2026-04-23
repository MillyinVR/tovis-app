// app/client/boards/_actions/createBoard.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { BoardVisibility } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  createBoard,
  getBoardErrorMeta,
  parseBoardVisibility,
} from '@/lib/boards'

const CREATE_BOARD_ROUTE = '/client/boards/new'
const CLIENT_ME_ROUTE = '/client/me'

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
    redirect(`/login?from=${encodeURIComponent(CREATE_BOARD_ROUTE)}`)
  }

  return user
}

function readTrimmedFormValue(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function buildCreateBoardErrorHref(message: string): string {
  return `${CREATE_BOARD_ROUTE}?error=${encodeURIComponent(message)}`
}

export async function createBoardAction(formData: FormData): Promise<void> {
  const user = await requireAuthedClientUser()

  const name = readTrimmedFormValue(formData, 'name')
  const rawVisibility = readTrimmedFormValue(formData, 'visibility')

  const visibility = parseBoardVisibility(rawVisibility)

  if (rawVisibility && !visibility) {
    redirect(buildCreateBoardErrorHref('Invalid board visibility.'))
  }

  try {
    const board = await createBoard(prisma, {
      clientId: user.clientProfile.id,
      name,
      visibility: visibility ?? BoardVisibility.PRIVATE,
    })

    revalidatePath(CLIENT_ME_ROUTE)
    revalidatePath(`/client/boards/${board.id}`)

    redirect(`/client/boards/${encodeURIComponent(board.id)}`)
  } catch (error) {
    const boardError = getBoardErrorMeta(error)

    if (boardError) {
      redirect(buildCreateBoardErrorHref(boardError.message))
    }

    throw error
  }
}