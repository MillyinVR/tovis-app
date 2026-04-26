// lib/proSession/sessionFlow.ts
import 'server-only'

import {
  BookingStatus,
  ConsultationApprovalProofMethod,
  ConsultationApprovalStatus,
  ConsultationDecision,
  SessionStep,
} from '@prisma/client'

import type {
  StepKey,
  UiSessionCenterAction,
  UiSessionMode,
} from '@/lib/proSession/types'

export const PRO_SESSION_START_WINDOW_MINUTES = 15

export type ProSessionRouteSet = {
  bookingBase: string
  sessionHub: string
  beforePhotos: string
  afterPhotos: string
  aftercare: string
}

export type ProSessionStartWindow = {
  windowStart: Date
  windowEnd: Date
}

export type ProSessionCenterState = {
  label: string
  action: UiSessionCenterAction
  href: string | null
}

export type ProSessionScreenKey =
  | 'CONSULTATION'
  | 'WAITING_ON_CLIENT'
  | 'BEFORE_PHOTOS'
  | 'SERVICE_IN_PROGRESS'
  | 'FINISH_REVIEW'
  | 'WRAP_UP'
  | 'DONE'

export type ProSessionStepKey =
  | 'consultation'
  | 'beforePhotos'
  | 'service'
  | 'wrapUp'

export type ProSessionStepState = 'idle' | 'active' | 'done'

export type ProSessionStepNumber = 1 | 2 | 3 | 4

export type ProSessionStepItem = {
  key: ProSessionStepKey
  number: ProSessionStepNumber
  label: string
  state: ProSessionStepState
}

export type ResolveEffectiveSessionStepArgs = {
  bookingStatus: BookingStatus
  rawStep: SessionStep | null | undefined
  consultationStatus: ConsultationApprovalStatus | null | undefined
}

export type GetSessionCenterStateArgs = {
  mode: UiSessionMode
  bookingId: string | null
  sessionStep: SessionStep | null | undefined
  hasBeforeMedia: boolean
  hasAfterMedia: boolean
}

export type GetSessionScreenKeyArgs = {
  effectiveStep: SessionStep
}

const SESSION_STEPS: Array<{
  key: ProSessionStepKey
  number: ProSessionStepNumber
  label: string
}> = [
  {
    key: 'consultation',
    number: 1,
    label: 'Consultation',
  },
  {
    key: 'beforePhotos',
    number: 2,
    label: 'Before photos',
  },
  {
    key: 'service',
    number: 3,
    label: 'Service',
  },
  {
    key: 'wrapUp',
    number: 4,
    label: 'After photos + Aftercare',
  },
]

function encodedBookingId(bookingId: string): string {
  return encodeURIComponent(bookingId)
}

export function getProSessionRoutes(bookingId: string): ProSessionRouteSet {
  const bookingBase = `/pro/bookings/${encodedBookingId(bookingId)}`

  return {
    bookingBase,
    sessionHub: `${bookingBase}/session`,
    beforePhotos: `${bookingBase}/session/before-photos`,
    afterPhotos: `${bookingBase}/session/after-photos`,
    aftercare: `${bookingBase}/aftercare`,
  }
}

export function bookingBaseHref(bookingId: string): string {
  return getProSessionRoutes(bookingId).bookingBase
}

export function sessionHubHref(bookingId: string): string {
  return getProSessionRoutes(bookingId).sessionHub
}

export function beforePhotosHref(bookingId: string): string {
  return getProSessionRoutes(bookingId).beforePhotos
}

export function afterPhotosHref(bookingId: string): string {
  return getProSessionRoutes(bookingId).afterPhotos
}

export function aftercareHref(bookingId: string): string {
  return getProSessionRoutes(bookingId).aftercare
}

export function getProSessionStartWindow(
  now: Date = new Date(),
): ProSessionStartWindow {
  const windowMs = PRO_SESSION_START_WINDOW_MINUTES * 60_000

  return {
    windowStart: new Date(now.getTime() - windowMs),
    windowEnd: new Date(now.getTime() + windowMs),
  }
}

export function isTerminalBooking(
  status: BookingStatus,
  finishedAt: Date | null | undefined,
): boolean {
  return (
    status === BookingStatus.CANCELLED ||
    status === BookingStatus.COMPLETED ||
    Boolean(finishedAt)
  )
}

export function isConsultationApproved(
  status: ConsultationApprovalStatus | null | undefined,
): boolean {
  return status === ConsultationApprovalStatus.APPROVED
}

export function isConsultationRejected(
  status: ConsultationApprovalStatus | null | undefined,
): boolean {
  return status === ConsultationApprovalStatus.REJECTED
}

export function isConsultationPending(
  status: ConsultationApprovalStatus | null | undefined,
): boolean {
  return status === ConsultationApprovalStatus.PENDING
}

function isPostConsultationStep(step: SessionStep): boolean {
  return (
    step === SessionStep.BEFORE_PHOTOS ||
    step === SessionStep.SERVICE_IN_PROGRESS ||
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE
  )
}

export function resolveEffectiveSessionStep({
  bookingStatus,
  rawStep,
  consultationStatus,
}: ResolveEffectiveSessionStepArgs): SessionStep {
  const step = rawStep ?? SessionStep.NONE

  if (bookingStatus === BookingStatus.PENDING) {
    return SessionStep.CONSULTATION
  }

  if (consultationStatus === ConsultationApprovalStatus.REJECTED) {
    return SessionStep.CONSULTATION
  }

  if (
    consultationStatus === ConsultationApprovalStatus.APPROVED &&
    step === SessionStep.CONSULTATION_PENDING_CLIENT
  ) {
    return SessionStep.BEFORE_PHOTOS
  }

  if (
    consultationStatus !== ConsultationApprovalStatus.APPROVED &&
    isPostConsultationStep(step)
  ) {
    return SessionStep.CONSULTATION
  }

  return step
}

export function labelForSessionStep(
  step: SessionStep | null | undefined,
): string {
  if (!step || step === SessionStep.NONE) return 'Not started'
  if (step === SessionStep.CONSULTATION) return 'Consultation'
  if (step === SessionStep.CONSULTATION_PENDING_CLIENT) {
    return 'Waiting on client'
  }
  if (step === SessionStep.BEFORE_PHOTOS) return 'Before photos'
  if (step === SessionStep.SERVICE_IN_PROGRESS) return 'Service in progress'
  if (step === SessionStep.FINISH_REVIEW) return 'Finish review'
  if (step === SessionStep.AFTER_PHOTOS) {
    return 'Wrap-up: aftercare + photos'
  }
  if (step === SessionStep.DONE) return 'Done'

  return 'Session'
}

export function labelForConsultationStatus(
  status: ConsultationApprovalStatus | null | undefined,
): string {
  if (status === ConsultationApprovalStatus.PENDING) return 'Pending'
  if (status === ConsultationApprovalStatus.APPROVED) return 'Approved'
  if (status === ConsultationApprovalStatus.REJECTED) return 'Rejected'

  return 'None'
}

export function labelForProofMethod(
  method: ConsultationApprovalProofMethod | null | undefined,
): string {
  if (method === ConsultationApprovalProofMethod.REMOTE_SECURE_LINK) {
    return 'Remote secure link'
  }

  if (method === ConsultationApprovalProofMethod.IN_PERSON_PRO_DEVICE) {
    return 'In-person on pro device'
  }

  return 'Unknown'
}

export function labelForConsultationDecision(
  decision: ConsultationDecision | null | undefined,
): string {
  if (decision === ConsultationDecision.APPROVED) return 'Approved'
  if (decision === ConsultationDecision.REJECTED) return 'Rejected'

  return 'Unknown'
}

export function targetStepFromSessionStep(
  step: SessionStep | null | undefined,
): StepKey {
  if (step === SessionStep.DONE) return 'aftercare'

  if (
    step === SessionStep.CONSULTATION ||
    step === SessionStep.CONSULTATION_PENDING_CLIENT
  ) {
    return 'consult'
  }

  return 'session'
}

function visualProgressNumberForStep(step: SessionStep): 0 | 1 | 2 | 3 | 4 | 5 {
  if (step === SessionStep.DONE) return 5

  if (
    step === SessionStep.NONE ||
    step === SessionStep.CONSULTATION ||
    step === SessionStep.CONSULTATION_PENDING_CLIENT
  ) {
    return 1
  }

  if (step === SessionStep.BEFORE_PHOTOS) return 2

  if (step === SessionStep.SERVICE_IN_PROGRESS) return 3

  if (
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS
  ) {
    return 4
  }

  return 0
}

function stepStateForProgress(
  stepNumber: ProSessionStepNumber,
  progressNumber: 0 | 1 | 2 | 3 | 4 | 5,
): ProSessionStepState {
  if (progressNumber === 5) return 'done'
  if (stepNumber < progressNumber) return 'done'
  if (stepNumber === progressNumber) return 'active'

  return 'idle'
}

export function buildSessionStepItems(
  effectiveStep: SessionStep,
): ProSessionStepItem[] {
  const progressNumber = visualProgressNumberForStep(effectiveStep)

  return SESSION_STEPS.map((step) => ({
    ...step,
    state: stepStateForProgress(step.number, progressNumber),
  }))
}

export function getSessionScreenKey({
  effectiveStep,
}: GetSessionScreenKeyArgs): ProSessionScreenKey {
  if (
    effectiveStep === SessionStep.NONE ||
    effectiveStep === SessionStep.CONSULTATION
  ) {
    return 'CONSULTATION'
  }

  if (effectiveStep === SessionStep.CONSULTATION_PENDING_CLIENT) {
    return 'WAITING_ON_CLIENT'
  }

  if (effectiveStep === SessionStep.BEFORE_PHOTOS) {
    return 'BEFORE_PHOTOS'
  }

  if (effectiveStep === SessionStep.SERVICE_IN_PROGRESS) {
    return 'SERVICE_IN_PROGRESS'
  }

  if (effectiveStep === SessionStep.FINISH_REVIEW) {
    return 'FINISH_REVIEW'
  }

  if (effectiveStep === SessionStep.AFTER_PHOTOS) {
    return 'WRAP_UP'
  }

  if (effectiveStep === SessionStep.DONE) {
    return 'DONE'
  }

  return 'CONSULTATION'
}

export function getSessionCenterState({
  mode,
  bookingId,
  sessionStep,
  hasBeforeMedia,
  hasAfterMedia,
}: GetSessionCenterStateArgs): ProSessionCenterState {
  if (mode === 'IDLE' || !bookingId) {
    return {
      label: 'Start',
      action: 'NONE',
      href: null,
    }
  }

  if (mode === 'UPCOMING_PICKER') {
    return {
      label: 'Choose booking',
      action: 'PICK_BOOKING',
      href: null,
    }
  }

  const routes = getProSessionRoutes(bookingId)

  if (mode === 'UPCOMING') {
    return {
      label: 'Start',
      action: 'START',
      href: routes.sessionHub,
    }
  }

  const step = sessionStep ?? SessionStep.NONE

  if (step === SessionStep.NONE) {
    return {
      label: 'Consult',
      action: 'NAVIGATE',
      href: routes.sessionHub,
    }
  }

  if (step === SessionStep.DONE) {
    return {
      label: 'Aftercare',
      action: 'NAVIGATE',
      href: routes.aftercare,
    }
  }

  if (
    step === SessionStep.CONSULTATION ||
    step === SessionStep.CONSULTATION_PENDING_CLIENT
  ) {
    return {
      label: 'Camera',
      action: 'CAPTURE_BEFORE',
      href: routes.beforePhotos,
    }
  }

  if (step === SessionStep.BEFORE_PHOTOS) {
    if (!hasBeforeMedia) {
      return {
        label: 'Camera',
        action: 'CAPTURE_BEFORE',
        href: routes.beforePhotos,
      }
    }

    return {
      label: 'Continue',
      action: 'NAVIGATE',
      href: routes.sessionHub,
    }
  }

  if (step === SessionStep.SERVICE_IN_PROGRESS) {
    return {
      label: 'Finish',
      action: 'FINISH',
      href: null,
    }
  }

  if (step === SessionStep.FINISH_REVIEW) {
    return {
      label: 'Continue',
      action: 'NAVIGATE',
      href: routes.sessionHub,
    }
  }

  if (step === SessionStep.AFTER_PHOTOS) {
    if (!hasAfterMedia) {
      return {
        label: 'Camera',
        action: 'CAPTURE_AFTER',
        href: routes.afterPhotos,
      }
    }

    return {
      label: 'Aftercare',
      action: 'NAVIGATE',
      href: routes.aftercare,
    }
  }

  return {
    label: 'Continue',
    action: 'NAVIGATE',
    href: routes.sessionHub,
  }
}