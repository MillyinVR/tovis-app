// app/(main)/looks/_components/SaveToBoardModal.tsx
'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import type {
  LooksBoardItemMutationResponseDto,
  LooksSaveStateResponseDto,
  LooksSavedBoardStateDto,
} from '@/lib/looks/types'
import { cn } from '@/lib/utils'

type SaveToBoardModalProps = {
  isOpen: boolean
  lookPostId: string
  onClose: () => void
  title?: string | null
  onSaveStateChange?: (state: LooksSaveStateResponseDto) => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type ModalMode = 'list' | 'create'
type BoardVisibilityValue = 'PRIVATE' | 'SHARED'

type ModalBoard = {
  id: string
  name: string
  visibility: string
  itemCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSavedBoardStateDto(value: unknown): value is LooksSavedBoardStateDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.visibility === 'string'
  )
}

function isSaveStateResponseDto(
  value: unknown,
): value is LooksSaveStateResponseDto {
  return (
    isRecord(value) &&
    typeof value.lookPostId === 'string' &&
    typeof value.isSaved === 'boolean' &&
    typeof value.saveCount === 'number' &&
    isStringArray(value.boardIds) &&
    Array.isArray(value.boards) &&
    value.boards.every(isSavedBoardStateDto)
  )
}

function isBoardItemMutationResponseDto(
  value: unknown,
): value is LooksBoardItemMutationResponseDto {
  return (
    isRecord(value) &&
    typeof value.boardId === 'string' &&
    typeof value.lookPostId === 'string' &&
    typeof value.inBoard === 'boolean' &&
    typeof value.isSaved === 'boolean' &&
    typeof value.saveCount === 'number' &&
    isStringArray(value.boardIds) &&
    Array.isArray(value.boards) &&
    value.boards.every(isSavedBoardStateDto)
  )
}

function parseModalBoard(value: unknown): ModalBoard | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string') return null
  if (typeof value.name !== 'string') return null
  if (typeof value.visibility !== 'string') return null

  return {
    id: value.id,
    name: value.name,
    visibility: value.visibility,
    itemCount: typeof value.itemCount === 'number' ? value.itemCount : 0,
  }
}

function parseBoardsList(value: unknown): ModalBoard[] | null {
  if (!isRecord(value) || !Array.isArray(value.boards)) return null

  const boards: ModalBoard[] = []
  for (const entry of value.boards) {
    const board = parseModalBoard(entry)
    if (!board) return null
    boards.push(board)
  }

  return boards
}

function parseCreatedBoard(value: unknown): ModalBoard | null {
  if (!isRecord(value)) return null
  return parseModalBoard(value.board)
}

function readErrorMessage(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === 'string' && value.error.trim()) {
    return value.error
  }
  return fallback
}

function normalizeSaveState(
  value: LooksSaveStateResponseDto | LooksBoardItemMutationResponseDto,
): LooksSaveStateResponseDto {
  return {
    lookPostId: value.lookPostId,
    isSaved: value.isSaved,
    saveCount: value.saveCount,
    boardIds: [...value.boardIds],
    boards: value.boards.map((board) => ({
      id: board.id,
      name: board.name,
      visibility: board.visibility,
    })),
  }
}

function mergeBoardList(previous: ModalBoard[], nextBoard: ModalBoard): ModalBoard[] {
  const filtered = previous.filter((board) => board.id !== nextBoard.id)
  return [nextBoard, ...filtered]
}

function SaveRowButton(props: {
  pending: boolean
  inBoard: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={props.pending}
      onClick={props.onClick}
      className={cn(
        'inline-flex min-h-10 min-w-[88px] items-center justify-center rounded-full border px-3 py-2',
        'text-[12px] font-bold transition',
        props.inBoard
          ? 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20'
          : 'border-[rgb(var(--accent-primary))]/25 bg-[rgb(var(--accent-primary))]/10 text-textPrimary hover:border-[rgb(var(--accent-primary))]/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      {props.pending ? 'Saving…' : props.inBoard ? 'Saved' : 'Save'}
    </button>
  )
}

export default function SaveToBoardModal({
  isOpen,
  lookPostId,
  onClose,
  title = null,
  onSaveStateChange,
}: SaveToBoardModalProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<LooksSaveStateResponseDto | null>(null)
  const [boards, setBoards] = useState<ModalBoard[]>([])
  const [pendingBoardId, setPendingBoardId] = useState<string | null>(null)

  const [mode, setMode] = useState<ModalMode>('list')
  const [createName, setCreateName] = useState('')
  const [createVisibility, setCreateVisibility] =
    useState<BoardVisibilityValue>('PRIVATE')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const hasBoards = boards.length > 0

  const modalTitle = useMemo(() => {
    const trimmed = title?.trim()
    return trimmed ? `Save “${trimmed}”` : 'Save to board'
  }, [title])

  const applySaveState = useCallback(
    (nextState: LooksSaveStateResponseDto) => {
      setSaveState(nextState)
      setErrorMessage(null)
      setLoadState('ready')
      onSaveStateChange?.(nextState)
    },
    [onSaveStateChange],
  )

  const loadModalData = useCallback(async () => {
    if (!lookPostId.trim()) {
      setSaveState(null)
      setBoards([])
      setErrorMessage('Missing look id.')
      setLoadState('error')
      return
    }

    try {
      setLoadState('loading')
      setErrorMessage(null)

      const [boardsResponse, saveStateResponse] = await Promise.all([
        fetch('/api/boards', {
          method: 'GET',
          cache: 'no-store',
        }),
        fetch(`/api/looks/${encodeURIComponent(lookPostId)}/save`, {
          method: 'GET',
          cache: 'no-store',
        }),
      ])

      const boardsPayload: unknown = await boardsResponse.json().catch(() => null)
      const saveStatePayload: unknown = await saveStateResponse
        .json()
        .catch(() => null)

      if (!boardsResponse.ok) {
        throw new Error(readErrorMessage(boardsPayload, 'Couldn’t load boards.'))
      }

      if (!saveStateResponse.ok) {
        throw new Error(
          readErrorMessage(saveStatePayload, 'Couldn’t load save state.'),
        )
      }

      const nextBoards = parseBoardsList(boardsPayload)
      if (!nextBoards) {
        throw new Error('Received an invalid boards response.')
      }

      if (!isSaveStateResponseDto(saveStatePayload)) {
        throw new Error('Received an invalid save-state response.')
      }

      setBoards(nextBoards)
      applySaveState(saveStatePayload)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Couldn’t load boards.'
      setBoards([])
      setSaveState(null)
      setErrorMessage(message)
      setLoadState('error')
    }
  }, [applySaveState, lookPostId])

  const updateBoardMembership = useCallback(
    async (boardId: string, inBoard: boolean) => {
      if (!lookPostId.trim()) return

      try {
        setPendingBoardId(boardId)
        setErrorMessage(null)

        const response = await fetch(
          `/api/looks/${encodeURIComponent(lookPostId)}/save`,
          {
            method: inBoard ? 'DELETE' : 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({ boardId }),
          },
        )

        const payload: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, 'Couldn’t update board.'))
        }

        if (!isBoardItemMutationResponseDto(payload)) {
          throw new Error('Received an invalid board update response.')
        }

        applySaveState(normalizeSaveState(payload))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Couldn’t update board.'
        setErrorMessage(message)
      } finally {
        setPendingBoardId(null)
      }
    },
    [applySaveState, lookPostId],
  )

  const createBoardInline = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      const name = createName.trim()
      if (!name) {
        setCreateError('Board name is required.')
        return
      }

      try {
        setCreating(true)
        setCreateError(null)

        const response = await fetch('/api/boards', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name,
            visibility: createVisibility,
          }),
        })

        const payload: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, 'Couldn’t create board.'))
        }

        const createdBoard = parseCreatedBoard(payload)
        if (!createdBoard) {
          throw new Error('Received an invalid board response.')
        }

        setBoards((previous) => mergeBoardList(previous, createdBoard))
        setCreateName('')
        setCreateVisibility('PRIVATE')
        setMode('list')

        await updateBoardMembership(createdBoard.id, false)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Couldn’t create board.'
        setCreateError(message)
      } finally {
        setCreating(false)
      }
    },
    [createName, createVisibility, updateBoardMembership],
  )

  useEffect(() => {
    if (!isOpen) return
    void loadModalData()
  }, [isOpen, loadModalData])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) return
    setMode('list')
    setCreateError(null)
    setCreateName('')
    setCreateVisibility('PRIVATE')
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close save to board modal"
        onClick={onClose}
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
                <h2 className="mt-1 text-[20px] font-bold leading-tight text-textPrimary">
                  {mode === 'create' ? 'Create new board' : modalTitle}
                </h2>
                <p className="mt-1 text-[13px] text-textSecondary">
                  {mode === 'create'
                    ? 'Create a board and save this look into it.'
                    : 'Choose where this look should live.'}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-bgPrimary text-textSecondary transition hover:border-white/20 hover:text-textPrimary"
              >
                ×
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-y-contain [webkit-overflow-scrolling:touch]">
            {errorMessage ? (
              <div className="mb-4 rounded-card border border-red-400/20 bg-red-400/10 px-4 py-3 text-[13px] text-textPrimary">
                {errorMessage}
              </div>
            ) : null}

            {mode === 'create' ? (
              <form onSubmit={createBoardInline} className="grid gap-4">
                {createError ? (
                  <div className="rounded-card border border-red-400/20 bg-red-400/10 px-4 py-3 text-[13px] text-textPrimary">
                    {createError}
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor="save-board-name"
                    className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-textSecondary"
                  >
                    Board name
                  </label>
                  <input
                    id="save-board-name"
                    name="name"
                    type="text"
                    maxLength={120}
                    placeholder="Summer hair inspo"
                    autoComplete="off"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    className={cn(
                      'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-3',
                      'text-[14px] text-textPrimary outline-none transition',
                      'placeholder:text-textMuted focus:border-white/20',
                    )}
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="save-board-visibility"
                    className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-textSecondary"
                  >
                    Visibility
                  </label>

                  <select
                    id="save-board-visibility"
                    name="visibility"
                    value={createVisibility}
                    onChange={(event) =>
                      setCreateVisibility(
                        event.target.value === 'SHARED' ? 'SHARED' : 'PRIVATE',
                      )
                    }
                    className={cn(
                      'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-3',
                      'text-[14px] text-textPrimary outline-none transition',
                      'focus:border-white/20',
                    )}
                  >
                    <option value="PRIVATE">Private</option>
                    <option value="SHARED">Shared</option>
                  </select>

                  <p className="mt-2 text-[12px] leading-5 text-textSecondary">
                    Private boards are just for you. Shared boards can be surfaced
                    later when that flow is ready.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
                  <button
                    type="submit"
                    disabled={creating}
                    className={cn(
                      'inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2',
                      'text-[12px] font-bold text-textPrimary transition hover:border-white/20',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                  >
                    {creating ? 'Creating…' : 'Create and save'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('list')
                      setCreateError(null)
                    }}
                    className="inline-flex min-h-11 items-center rounded-full border border-transparent px-2 py-2 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
                  >
                    Back
                  </button>
                </div>
              </form>
            ) : (
              <>
                {loadState === 'loading' ? (
                  <div className="rounded-card border border-white/10 bg-bgPrimary px-4 py-8 text-center text-[13px] text-textSecondary">
                    Loading boards…
                  </div>
                ) : null}

                {loadState === 'error' && !saveState ? (
                  <div className="grid gap-3">
                    <div className="rounded-card border border-white/10 bg-bgPrimary px-4 py-8 text-center text-[13px] text-textSecondary">
                      We couldn’t load your boards.
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void loadModalData()}
                        className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-bold text-textPrimary transition hover:border-white/20"
                      >
                        Retry
                      </button>

                      <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex min-h-11 items-center rounded-full border border-transparent px-2 py-2 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                ) : null}

                {saveState ? (
                <div className="grid gap-4">
                    <div className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3">
                    <div className="text-[12px] font-bold text-textPrimary">
                        {saveState.isSaved
                        ? `Saved in ${saveState.boardIds.length} board${
                            saveState.boardIds.length === 1 ? '' : 's'
                            }`
                        : 'Not saved yet'}
                    </div>
                    <div className="mt-1 text-[12px] text-textSecondary">
                        {saveState.saveCount} total save
                        {saveState.saveCount === 1 ? '' : 's'}
                    </div>
                    </div>

                    <button
                    type="button"
                    onClick={() => {
                        setMode('create')
                        setCreateError(null)
                    }}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-[12px] font-bold text-textPrimary transition hover:border-white/20"
                    >
                    Create new board
                    </button>

                    {hasBoards ? (
                    <div className="grid gap-3">
                        {boards.map((board) => {
                        const inBoard = saveState.boardIds.includes(board.id)
                        const isPending = pendingBoardId === board.id

                        return (
                            <div
                            key={board.id}
                            className="flex items-center justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary px-4 py-3"
                            >
                            <div className="min-w-0">
                                <div className="truncate text-[14px] font-bold text-textPrimary">
                                {board.name}
                                </div>
                                <div className="mt-1 text-[11px] uppercase tracking-wide text-textSecondary">
                                {board.visibility.toLowerCase()}
                                {board.itemCount > 0 ? ` · ${board.itemCount} saved` : ''}
                                </div>
                            </div>

                            <SaveRowButton
                                pending={isPending}
                                inBoard={inBoard}
                                onClick={() => void updateBoardMembership(board.id, inBoard)}
                            />
                            </div>
                        )
                        })}
                    </div>
                    ) : loadState === 'ready' ? (
                    <div className="rounded-card border border-white/10 bg-bgPrimary px-4 py-8 text-center">
                        <div className="text-[14px] font-bold text-textPrimary">
                        You don’t have any boards yet.
                        </div>
                        <div className="mt-2 text-[13px] text-textSecondary">
                        Create one here, then save this look into it.
                        </div>
                    </div>
                    ) : null}
                </div>
                ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              {mode === 'list' ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode('create')
                    setCreateError(null)
                  }}
                  className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-bold text-textPrimary transition hover:border-white/20"
                >
                  Create new board
                </button>
              ) : null}

                <div className="shrink-0 border-t border-white/10 px-4 py-4">
                <div className="flex flex-wrap items-center gap-3">
                    <Link
                    href="/client/me"
                    className="inline-flex min-h-11 items-center rounded-full border border-transparent px-2 py-2 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
                    >
                    Go to Me
                    </Link>

                    <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex min-h-11 items-center rounded-full border border-transparent px-2 py-2 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
                    >
                    Done
                    </button>
                </div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}