// app/pro/calendar/_hooks/useCalendarNavigation.ts
'use client'

import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { ViewMode } from '../_types'

import {
  addDaysAnchorNoonInTimeZone,
  anchorNoonInTimeZone,
  getZonedParts,
} from '../_utils/date'

import {
  DEFAULT_TIME_ZONE,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

type UseCalendarNavigationArgs = {
  view: ViewMode
  timeZone: string
  setCurrentDate: Dispatch<SetStateAction<Date>>
}

type LocalMonthParts = {
  year: number
  month: number
}

const DAYS_PER_WEEK = 7
const LOCAL_NOON_HOUR = 12

function safeTimeZone(timeZone: string) {
  return sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function shiftMonthParts(args: {
  year: number
  month: number
  deltaMonths: number
}): LocalMonthParts {
  const zeroBasedMonthIndex =
    args.year * 12 + (args.month - 1) + args.deltaMonths

  const year = Math.floor(zeroBasedMonthIndex / 12)
  const month = zeroBasedMonthIndex - year * 12 + 1

  return {
    year,
    month,
  }
}

function addMonthsClampedAnchorNoonInTimeZone(args: {
  anchorUtc: Date
  deltaMonths: number
  timeZone: string
}) {
  const parts = getZonedParts(args.anchorUtc, args.timeZone)
  const shifted = shiftMonthParts({
    year: parts.year,
    month: parts.month,
    deltaMonths: args.deltaMonths,
  })

  const maxDay = daysInMonth(shifted.year, shifted.month)
  const day = Math.min(parts.day, maxDay)

  return zonedTimeToUtc({
    year: shifted.year,
    month: shifted.month,
    day,
    hour: LOCAL_NOON_HOUR,
    minute: 0,
    second: 0,
    timeZone: args.timeZone,
  })
}

function shiftDate(args: {
  view: ViewMode
  date: Date
  step: number
  timeZone: string
}) {
  const anchoredDate = anchorNoonInTimeZone(args.date, args.timeZone)

  if (args.view === 'day') {
    return addDaysAnchorNoonInTimeZone(
      anchoredDate,
      args.step,
      args.timeZone,
    )
  }

  if (args.view === 'week') {
    return addDaysAnchorNoonInTimeZone(
      anchoredDate,
      args.step * DAYS_PER_WEEK,
      args.timeZone,
    )
  }

  return addMonthsClampedAnchorNoonInTimeZone({
    anchorUtc: anchoredDate,
    deltaMonths: args.step,
    timeZone: args.timeZone,
  })
}

export function useCalendarNavigation(args: UseCalendarNavigationArgs) {
  const { view, timeZone, setCurrentDate } = args

  const calendarTimeZone = useMemo(
    () => safeTimeZone(timeZone),
    [timeZone],
  )

  const goToToday = useCallback(() => {
    setCurrentDate(anchorNoonInTimeZone(new Date(), calendarTimeZone))
  }, [calendarTimeZone, setCurrentDate])

  const goBack = useCallback(() => {
    setCurrentDate((currentDate) =>
      shiftDate({
        view,
        date: currentDate,
        step: -1,
        timeZone: calendarTimeZone,
      }),
    )
  }, [calendarTimeZone, setCurrentDate, view])

  const goNext = useCallback(() => {
    setCurrentDate((currentDate) =>
      shiftDate({
        view,
        date: currentDate,
        step: 1,
        timeZone: calendarTimeZone,
      }),
    )
  }, [calendarTimeZone, setCurrentDate, view])

  return {
    goToToday,
    goBack,
    goNext,
  }
}