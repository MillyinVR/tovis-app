// lib/booking/lifecycleActionViewModel.test.ts
import { describe, expect, it } from 'vitest'
import { requireDefined } from '@/lib/guards'
import { BookingStatus, SessionStep } from '@prisma/client'
import {
  buildLifecycleActionViewModel,
  type LifecycleActionVerb,
  type LifecycleViewerRole,
  type LifecycleViewModelInput,
} from './lifecycleActionViewModel'

const BOOKING_ID = 'bk_test_1'

function input(
  overrides: Partial<LifecycleViewModelInput> & {
    status: BookingStatus
    role: LifecycleViewerRole
  },
): LifecycleViewModelInput {
  return {
    bookingId: BOOKING_ID,
    sessionStep: SessionStep.NONE,
    rescheduleHoldId: 'hold_1',
    ...overrides,
  }
}

function verbs(
  vm: ReturnType<typeof buildLifecycleActionViewModel>,
): LifecycleActionVerb[] {
  return vm.actions.map((a) => a.verb)
}

describe('buildLifecycleActionViewModel — pro role', () => {
  it('PENDING → Accept + Cancel', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.PENDING, role: 'PRO' }),
    )
    expect(verbs(vm)).toEqual(['ACCEPT', 'CANCEL'])
    expect(vm.isTerminal).toBe(false)
    expect(vm.isInProgress).toBe(false)
    expect(requireDefined(vm.actions[0]).method).toBe('PATCH')
    expect(requireDefined(vm.actions[0]).payload).toEqual({
      status: 'ACCEPTED',
      notifyClient: true,
    })
    expect(vm.displayLabel).toBe('Pending')
  })

  it('ACCEPTED → Start booking + Cancel', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.ACCEPTED, role: 'PRO' }),
    )
    expect(verbs(vm)).toEqual(['START_SESSION', 'CANCEL'])
    expect(requireDefined(vm.actions[0]).href).toBe(
      `/api/v1/pro/bookings/${BOOKING_ID}/session/start`,
    )
    expect(requireDefined(vm.actions[0]).method).toBe('POST')
    expect(requireDefined(vm.actions[0]).payload).toEqual({
      explicitSelection: true,
    })
    expect(vm.displayLabel).toBe('Confirmed')
  })

  it('ACCEPTED with no-show feature off → no Mark no-show action', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.ACCEPTED, role: 'PRO' }),
    )
    expect(verbs(vm)).not.toContain('NO_SHOW')
  })

  it('ACCEPTED with no-show feature on → adds Mark no-show', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.ACCEPTED,
        role: 'PRO',
        noShowFeatureEnabled: true,
      }),
    )
    expect(verbs(vm)).toEqual(['START_SESSION', 'CANCEL', 'NO_SHOW'])

    const noShow = vm.actions.find((a) => a.verb === 'NO_SHOW')
    expect(requireDefined(noShow).method).toBe('POST')
    expect(requireDefined(noShow).href).toBe(
      `/api/v1/pro/bookings/${BOOKING_ID}/no-show`,
    )
    expect(requireDefined(noShow).confirmCopy).toBeTruthy()
  })

  it('IN_PROGRESS at any non-DONE step → Continue session', () => {
    for (const step of [
      SessionStep.NONE,
      SessionStep.CONSULTATION,
      SessionStep.CONSULTATION_PENDING_CLIENT,
      SessionStep.BEFORE_PHOTOS,
      SessionStep.SERVICE_IN_PROGRESS,
      SessionStep.FINISH_REVIEW,
      SessionStep.AFTER_PHOTOS,
    ]) {
      const vm = buildLifecycleActionViewModel(
        input({
          status: BookingStatus.IN_PROGRESS,
          sessionStep: step,
          role: 'PRO',
        }),
      )
      expect(verbs(vm)).toEqual(['CONTINUE_SESSION'])
      expect(requireDefined(vm.actions[0]).method).toBe('NAVIGATE')
      expect(requireDefined(vm.actions[0]).href).toBe(`/pro/bookings/${BOOKING_ID}/session`)
      expect(vm.isInProgress).toBe(true)
      expect(vm.isTerminal).toBe(false)
    }
  })

  it('IN_PROGRESS at DONE → no card actions (handled at session page)', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.DONE,
        role: 'PRO',
      }),
    )
    expect(verbs(vm)).toEqual([])
  })

  it('COMPLETED → terminal, no actions', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.COMPLETED, role: 'PRO' }),
    )
    expect(verbs(vm)).toEqual([])
    expect(vm.isTerminal).toBe(true)
    expect(vm.displayLabel).toBe('Completed')
  })

  it('CANCELLED → terminal, no actions', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.CANCELLED, role: 'PRO' }),
    )
    expect(verbs(vm)).toEqual([])
    expect(vm.isTerminal).toBe(true)
    expect(vm.displayLabel).toBe('Cancelled')
  })

  it('blockers: BEFORE_MEDIA_REQUIRED when at BEFORE_PHOTOS with zero before media', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.BEFORE_PHOTOS,
        role: 'PRO',
        beforeMediaCount: 0,
      }),
    )
    expect(vm.blockerCodes).toContain('BEFORE_MEDIA_REQUIRED')
  })

  it('blockers: PAYMENT_NOT_COLLECTED when at AFTER_PHOTOS without payment', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.AFTER_PHOTOS,
        role: 'PRO',
      }),
    )
    expect(vm.blockerCodes).toContain('PAYMENT_NOT_COLLECTED')
  })
})

describe('buildLifecycleActionViewModel — client role', () => {
  it('PENDING → Reschedule + Cancel booking', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.PENDING, role: 'CLIENT' }),
    )
    expect(verbs(vm)).toEqual(['CLIENT_RESCHEDULE', 'CLIENT_CANCEL'])
    expect(requireDefined(vm.actions[1]).href).toBe(`/api/v1/bookings/${BOOKING_ID}/cancel`)
  })

  it('ACCEPTED → Reschedule + Cancel booking', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.ACCEPTED, role: 'CLIENT' }),
    )
    expect(verbs(vm)).toEqual(['CLIENT_RESCHEDULE', 'CLIENT_CANCEL'])
  })

  it('IN_PROGRESS at CONSULTATION_PENDING_CLIENT → Review consultation, no cancel', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        role: 'CLIENT',
      }),
    )
    expect(verbs(vm)).toContain('CLIENT_APPROVE_CONSULTATION')
    expect(verbs(vm)).not.toContain('CLIENT_CANCEL')
    expect(vm.displayLabel).toBe('Consultation — awaiting approval')
  })

  it('IN_PROGRESS at any other step → no actions; status surfaces in label', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        role: 'CLIENT',
      }),
    )
    expect(verbs(vm)).toEqual([])
    expect(vm.displayLabel).toBe('Service in progress')
  })

  it('COMPLETED with aftercare link → View aftercare + Rebook', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.COMPLETED,
        role: 'CLIENT',
        hasAftercareLink: true,
      }),
    )
    expect(verbs(vm)).toEqual(['CLIENT_VIEW_AFTERCARE', 'CLIENT_REBOOK'])
  })

  it('COMPLETED without aftercare link → just Rebook', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.COMPLETED,
        role: 'CLIENT',
        hasAftercareLink: false,
      }),
    )
    expect(verbs(vm)).toEqual(['CLIENT_REBOOK'])
  })

  it('CANCELLED → no actions, terminal', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.CANCELLED, role: 'CLIENT' }),
    )
    expect(verbs(vm)).toEqual([])
    expect(vm.isTerminal).toBe(true)
  })

  it('blocker: NO_RESCHEDULE_HOLD surfaces when reschedule available but no hold', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.PENDING,
        role: 'CLIENT',
        rescheduleHoldId: null,
      }),
    )
    expect(vm.blockerCodes).toContain('NO_RESCHEDULE_HOLD')
  })
})

describe('buildLifecycleActionViewModel — timeline pills', () => {
  it('PENDING → only requested', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.PENDING, role: 'CLIENT' }),
    )
    expect(vm.timelinePills.find((p) => p.key === 'requested')?.on).toBe(true)
    expect(vm.timelinePills.find((p) => p.key === 'confirmed')?.on).toBe(false)
    expect(vm.timelinePills.find((p) => p.key === 'in_progress')?.on).toBe(
      false,
    )
    expect(vm.timelinePills.find((p) => p.key === 'completed')?.on).toBe(false)
  })

  it('ACCEPTED → requested + confirmed', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.ACCEPTED, role: 'CLIENT' }),
    )
    expect(vm.timelinePills.find((p) => p.key === 'confirmed')?.on).toBe(true)
    expect(vm.timelinePills.find((p) => p.key === 'in_progress')?.on).toBe(
      false,
    )
  })

  it('IN_PROGRESS → confirmed + in_progress', () => {
    const vm = buildLifecycleActionViewModel(
      input({
        status: BookingStatus.IN_PROGRESS,
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        role: 'CLIENT',
      }),
    )
    expect(vm.timelinePills.find((p) => p.key === 'confirmed')?.on).toBe(true)
    expect(vm.timelinePills.find((p) => p.key === 'in_progress')?.on).toBe(true)
    expect(vm.timelinePills.find((p) => p.key === 'completed')?.on).toBe(false)
  })

  it('COMPLETED → all green', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.COMPLETED, role: 'CLIENT' }),
    )
    for (const p of vm.timelinePills) expect(p.on).toBe(true)
  })

  it('CANCELLED → requested + cancelled, in_progress and completed not present', () => {
    const vm = buildLifecycleActionViewModel(
      input({ status: BookingStatus.CANCELLED, role: 'CLIENT' }),
    )
    expect(vm.timelinePills.map((p) => p.key)).toEqual([
      'requested',
      'cancelled',
    ])
  })
})
