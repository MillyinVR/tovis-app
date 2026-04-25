// app/pro/calendar/_hooks/useBlockActions.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { CalendarEvent } from '../_types'

import {
  extractBlockId,
  normalizeStepMinutes,
  snapMinutes,
} from '../_utils/calendarMath'

import { apiMessage } from '../_utils/parsers'

import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { errorMessageFromUnknown, safeJson } from '@/lib/http'

type BlockActionsDeps = {
  activeLocationId: string | null
  activeStepMinutes: number
  resolveActiveCalendarTimeZone: (fallback?: string) => string
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
}

type BlockRow = {
  id: string
  startsAt: string
  endsAt: string
  note: string | null
}

type CreateBlockPayload = {
  startsAt: string
  endsAt: string
  note: string | null
  locationId: string
}

const FULL_DAY_MINUTES = 24 * 60
const TEMPORARY_ERROR_MS = 3500
const SELECT_LOCATION_MESSAGE = 'Select a location first.'

function normalizeNote(note: string | null | undefined) {
  return typeof note === 'string' && note.trim() ? note.trim() : null
}

function errorFromUnknown(error: unknown) {
  return errorMessageFromUnknown(error, 'Failed to update blocked time.')
}

function blockEndpoint() {
  return '/api/pro/calendar/blocked'
}

function blockRowFromResponse(args: {
  data: unknown
  fallbackStartsAt: string
  fallbackEndsAt: string
  fallbackNote: string | null
}): BlockRow {
  if (!isRecord(args.data) || !isRecord(args.data.block)) {
    return {
      id: '',
      startsAt: args.fallbackStartsAt,
      endsAt: args.fallbackEndsAt,
      note: args.fallbackNote,
    }
  }

  const block = args.data.block

  return {
    id: pickString(block.id) ?? '',
    startsAt: pickString(block.startsAt) ?? args.fallbackStartsAt,
    endsAt: pickString(block.endsAt) ?? args.fallbackEndsAt,
    note: block.note === null ? null : normalizeNote(pickString(block.note)),
  }
}

function safeCalendarTimeZone(deps: BlockActionsDeps) {
  return sanitizeTimeZone(
    deps.resolveActiveCalendarTimeZone(DEFAULT_TIME_ZONE),
    DEFAULT_TIME_ZONE,
  )
}

function nextStepStartFromNow(args: {
  now: Date
  timeZone: string
  stepMinutes: number
}) {
  const stepMinutes = normalizeStepMinutes(args.stepMinutes)
  const zonedParts = getZonedParts(args.now, args.timeZone)
  const currentMinutes = zonedParts.hour * 60 + zonedParts.minute
  const roundedMinutes = snapMinutes(
    Math.ceil(currentMinutes / stepMinutes) * stepMinutes,
    stepMinutes,
  )

  if (roundedMinutes < FULL_DAY_MINUTES) {
    return utcFromDayAndMinutesInTimeZone(
      args.now,
      roundedMinutes,
      args.timeZone,
    )
  }

  const todayStart = startOfDayUtcInTimeZone(args.now, args.timeZone)
  const tomorrowStart = new Date(todayStart.getTime() + FULL_DAY_MINUTES * 60_000)

  return utcFromDayAndMinutesInTimeZone(
    tomorrowStart,
    0,
    args.timeZone,
  )
}

async function postBlock(payload: CreateBlockPayload): Promise<BlockRow> {
  const response = await fetch(blockEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    throw new Error(apiMessage(data, 'Failed to create block.'))
  }

  return blockRowFromResponse({
    data,
    fallbackStartsAt: payload.startsAt,
    fallbackEndsAt: payload.endsAt,
    fallbackNote: payload.note,
  })
}

export function useBlockActions(deps: BlockActionsDeps) {
  const [blockCreateOpen, setBlockCreateOpen] = useState(false)
  const [blockCreateInitialStart, setBlockCreateInitialStart] =
    useState<Date>(() => new Date())

  const [editBlockOpen, setEditBlockOpen] = useState(false)
  const [editBlockId, setEditBlockId] = useState<string | null>(null)

  const errorTokenRef = useRef(0)
  const errorTimeoutRef = useRef<number | null>(null)

  const clearTemporaryErrorTimer = useCallback(() => {
    if (errorTimeoutRef.current === null) return

    window.clearTimeout(errorTimeoutRef.current)
    errorTimeoutRef.current = null
  }, [])

  const showTemporaryError = useCallback(
    (message: string) => {
      errorTokenRef.current += 1
      const token = errorTokenRef.current

      clearTemporaryErrorTimer()
      deps.setError(message)

      errorTimeoutRef.current = window.setTimeout(() => {
        if (errorTokenRef.current !== token) return

        deps.setError(null)
        errorTimeoutRef.current = null
      }, TEMPORARY_ERROR_MS)
    },
    [clearTemporaryErrorTimer, deps],
  )

  const createBlock = useCallback(
    async (
      startsAtIso: string,
      endsAtIso: string,
      note?: string,
    ): Promise<BlockRow> => {
      const locationId = deps.activeLocationId

      if (!locationId) {
        throw new Error(SELECT_LOCATION_MESSAGE)
      }

      const startsAt = new Date(startsAtIso)
      const endsAt = new Date(endsAtIso)

      if (!Number.isFinite(startsAt.getTime())) {
        throw new Error('Invalid block start time.')
      }

      if (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
        throw new Error('Invalid block end time.')
      }

      return postBlock({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        note: normalizeNote(note),
        locationId,
      })
    },
    [deps.activeLocationId],
  )

  const oneClickBlockFullDay = useCallback(
    async (day: Date) => {
      if (!deps.activeLocationId) {
        showTemporaryError(SELECT_LOCATION_MESSAGE)
        return
      }

      deps.setLoading(true)
      deps.setError(null)

      try {
        const timeZone = safeCalendarTimeZone(deps)
        const startUtc = startOfDayUtcInTimeZone(day, timeZone)
        const endUtc = new Date(startUtc.getTime() + FULL_DAY_MINUTES * 60_000)

        await createBlock(
          startUtc.toISOString(),
          endUtc.toISOString(),
          'Full day off',
        )

        await deps.reloadCalendar()
        deps.forceProFooterRefresh()
      } catch (caught) {
        showTemporaryError(errorFromUnknown(caught))
      } finally {
        deps.setLoading(false)
      }
    },
    [createBlock, deps, showTemporaryError],
  )

  const openCreateBlockNow = useCallback(() => {
    if (!deps.activeLocationId) {
      showTemporaryError(SELECT_LOCATION_MESSAGE)
      return
    }

    const timeZone = safeCalendarTimeZone(deps)
    const startUtc = nextStepStartFromNow({
      now: new Date(),
      timeZone,
      stepMinutes: deps.activeStepMinutes,
    })

    setBlockCreateInitialStart(startUtc)
    setBlockCreateOpen(true)
  }, [deps, showTemporaryError])

  const openEditBlockFromEvent = useCallback((event: CalendarEvent) => {
    const blockId = extractBlockId(event)

    if (!blockId) return null

    setEditBlockId(blockId)
    setEditBlockOpen(true)

    return event.locationId ?? null
  }, [])

  useEffect(() => {
    return () => clearTemporaryErrorTimer()
  }, [clearTemporaryErrorTimer])

  return {
    blockCreateOpen,
    setBlockCreateOpen,
    blockCreateInitialStart,
    setBlockCreateInitialStart,

    editBlockOpen,
    setEditBlockOpen,
    editBlockId,
    setEditBlockId,

    createBlock,
    oneClickBlockFullDay,
    openCreateBlockNow,
    openEditBlockFromEvent,
  }
}

export type BlockActionsState = ReturnType<typeof useBlockActions>