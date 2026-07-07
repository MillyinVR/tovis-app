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
import {
  BOARD_QUESTION_SETS,
  parseBoardContextInput,
} from '@/lib/boards/context'

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

  // Optional creation-context fields (personalization spec §7): board type,
  // event date, and per-question chip answers submitted as `answer.<key>`.
  // All skippable — absent/blank fields simply aren't captured.
  const contextBody: Record<string, unknown> = {}
  const rawType = readTrimmedFormValue(formData, 'type')
  if (rawType) contextBody.type = rawType
  const rawEventDate = readTrimmedFormValue(formData, 'eventDate')
  if (rawEventDate) contextBody.eventDate = rawEventDate

  const answers: Record<string, string> = {}
  for (const questions of Object.values(BOARD_QUESTION_SETS)) {
    for (const def of questions) {
      const value = readTrimmedFormValue(formData, `answer.${def.key}`)
      if (value) answers[def.key] = value
    }
  }
  if (Object.keys(answers).length > 0) contextBody.answers = answers

  const context = parseBoardContextInput(contextBody)
  if (!context.ok) {
    redirect(buildCreateBoardErrorHref(context.error.message))
  }

  try {
    const board = await createBoard(prisma, {
      clientId: user.clientProfile.id,
      name,
      visibility: visibility ?? BoardVisibility.PRIVATE,
      ...context.value,
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