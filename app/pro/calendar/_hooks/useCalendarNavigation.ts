// app/pro/calendar/_hooks/useCalendarNavigation.ts 
'use client'

import { useCallback } from 'react'

import type { Dispatch, SetStateAction } from 'react'

import type { ViewMode } from '../_types'

import {
  anchorNoonInTimeZone,
  addDaysAnchorNoonInTimeZone,
  addMonthsAnchorNoonInTimeZone,
} from '../_utils/date'

type UseCalendarNavigationArgs = {
  view: ViewMode
  timeZone: string
  setCurrentDate: Dispatch<SetStateAction<Date>>
}

function shiftDate(view: ViewMode, date: Date, step: number, timeZone: string) {
  if (view === 'day') {
    return addDaysAnchorNoonInTimeZone(date, step, timeZone)
  }

  if (view === 'week') {
    return addDaysAnchorNoonInTimeZone(date, step * 7, timeZone)
  }

  return addMonthsAnchorNoonInTimeZone(date, step, timeZone)
}

export function useCalendarNavigation({
  view,
  timeZone,
  setCurrentDate,
}: UseCalendarNavigationArgs) {
  const goToToday = useCallback(() => {
    setCurrentDate(anchorNoonInTimeZone(new Date(), timeZone))
  }, [setCurrentDate, timeZone])

  const goBack = useCallback(() => {
    setCurrentDate((date) => shiftDate(view, date, -1, timeZone))
  }, [setCurrentDate, timeZone, view])

  const goNext = useCallback(() => {
    setCurrentDate((date) => shiftDate(view, date, 1, timeZone))
  }, [setCurrentDate, timeZone, view])

  return {
    goToToday,
    goBack,
    goNext,
  }
}