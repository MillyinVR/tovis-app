// lib/booking/policies/showSlotPolicy.ts 
import { isSlotFree, type BusyInterval } from '@/lib/booking/conflicts'
import {
  checkSlotReadiness,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'

export type ShowSlotResult =
  | {
      ok: true
      value: {
        startUtc: Date
        endUtc: Date
        timeZone: string
        stepMinutes: number
        durationMinutes: number
        bufferMinutes: number
      }
    }
  | {
      ok: false
      code: 'SLOT_NOT_READY' | 'SLOT_BUSY'
      slotReadinessCode?: SlotReadinessCode
      endUtc?: Date
      meta?: Record<string, unknown>
    }

export type CanShowSlotArgs = {
  startUtc: Date
  nowUtc: Date
  durationMinutes: number
  bufferMinutes: number
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  busy: BusyInterval[]
  fallbackTimeZone?: string
}

export function canShowSlot(args: CanShowSlotArgs): ShowSlotResult {
  const readiness = checkSlotReadiness({
    startUtc: args.startUtc,
    nowUtc: args.nowUtc,
    durationMinutes: args.durationMinutes,
    bufferMinutes: args.bufferMinutes,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
    stepMinutes: args.stepMinutes,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
    maxDaysAhead: args.maxDaysAhead,
    fallbackTimeZone: args.fallbackTimeZone ?? 'UTC',
  })

  if (!readiness.ok) {
    return {
      ok: false,
      code: 'SLOT_NOT_READY',
      slotReadinessCode: readiness.code,
      meta: (readiness.meta as Record<string, unknown> | undefined) ?? undefined,
    }
  }

  if (!isSlotFree(args.busy, args.startUtc, readiness.endUtc)) {
    return {
      ok: false,
      code: 'SLOT_BUSY',
      endUtc: readiness.endUtc,
    }
  }

  return {
    ok: true,
    value: {
      startUtc: args.startUtc,
      endUtc: readiness.endUtc,
      timeZone: readiness.timeZone,
      stepMinutes: readiness.stepMinutes,
      durationMinutes: readiness.durationMinutes,
      bufferMinutes: readiness.bufferMinutes,
    },
  }
}