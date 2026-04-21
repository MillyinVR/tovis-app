// lib/adminModeration/contracts.ts
import {
  LookPostStatus,
  ModerationStatus,
} from '@prisma/client'

import type {
  ViralRequestApprovalNotificationsDto,
  ViralRequestDto,
} from '@/lib/viralRequests/contracts'

export const LOOK_POST_MODERATION_ACTIONS = [
  'approve',
  'reject',
  'remove',
] as const

export const LOOK_COMMENT_MODERATION_ACTIONS = [
  'approve',
  'reject',
  'remove',
] as const

export const VIRAL_REQUEST_MODERATION_ACTIONS = [
  'mark_in_review',
  'approve',
  'reject',
] as const

export type AdminModerationTargetKind =
  | 'LOOK_POST'
  | 'LOOK_COMMENT'
  | 'VIRAL_SERVICE_REQUEST'

export type LookPostModerationAction =
  (typeof LOOK_POST_MODERATION_ACTIONS)[number]

export type LookCommentModerationAction =
  (typeof LOOK_COMMENT_MODERATION_ACTIONS)[number]

export type ViralRequestModerationAction =
  (typeof VIRAL_REQUEST_MODERATION_ACTIONS)[number]

export type AdminModerationAction =
  | LookPostModerationAction
  | LookCommentModerationAction
  | ViralRequestModerationAction

export type LookPostModerationRequestDto = {
  action: LookPostModerationAction
}

export type LookCommentModerationRequestDto = {
  action: LookCommentModerationAction
}

export type ViralRequestModerationRequestDto = {
  action: ViralRequestModerationAction
  adminNotes?: string
}

export type AdminModerationRequestDto =
  | LookPostModerationRequestDto
  | LookCommentModerationRequestDto
  | ViralRequestModerationRequestDto

export type LookPostModerationTargetDto = {
  kind: 'LOOK_POST'
  id: string
}

export type LookCommentModerationTargetDto = {
  kind: 'LOOK_COMMENT'
  id: string
  lookPostId: string
}

export type ViralRequestModerationTargetDto = {
  kind: 'VIRAL_SERVICE_REQUEST'
  id: string
}

export type AdminModerationTargetDto =
  | LookPostModerationTargetDto
  | LookCommentModerationTargetDto
  | ViralRequestModerationTargetDto

export type LookPostModerationStateDto = {
  id: string
  status: LookPostStatus
  moderationStatus: ModerationStatus
  archivedAt: string | null
  removedAt: string | null
}

export type LookCommentModerationStateDto = {
  id: string
  lookPostId: string
  moderationStatus: ModerationStatus
  commentsCount: number
}

export type ViralRequestModerationStateDto = {
  request: ViralRequestDto
  notifications?: ViralRequestApprovalNotificationsDto
}

export type LookPostModerationResultDto = {
  target: LookPostModerationTargetDto
  action: LookPostModerationAction
  result: LookPostModerationStateDto
}

export type LookCommentModerationResultDto = {
  target: LookCommentModerationTargetDto
  action: LookCommentModerationAction
  result: LookCommentModerationStateDto
}

export type ViralRequestModerationResultDto = {
  target: ViralRequestModerationTargetDto
  action: ViralRequestModerationAction
  result: ViralRequestModerationStateDto
}

export type AdminModerationResultDto =
  | LookPostModerationResultDto
  | LookCommentModerationResultDto
  | ViralRequestModerationResultDto

export type LegacyViralRequestApproveResponseDto = {
  request: ViralRequestDto
  notifications: ViralRequestApprovalNotificationsDto
}

export type LegacyViralRequestRejectResponseDto = {
  request: ViralRequestDto
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === 'string' && options.some((option) => option === value)
}

export function isLookPostModerationAction(
  value: unknown,
): value is LookPostModerationAction {
  return isOneOf(value, LOOK_POST_MODERATION_ACTIONS)
}

export function isLookCommentModerationAction(
  value: unknown,
): value is LookCommentModerationAction {
  return isOneOf(value, LOOK_COMMENT_MODERATION_ACTIONS)
}

export function isViralRequestModerationAction(
  value: unknown,
): value is ViralRequestModerationAction {
  return isOneOf(value, VIRAL_REQUEST_MODERATION_ACTIONS)
}

export function isAdminModerationTargetKind(
  value: unknown,
): value is AdminModerationTargetKind {
  return (
    value === 'LOOK_POST' ||
    value === 'LOOK_COMMENT' ||
    value === 'VIRAL_SERVICE_REQUEST'
  )
}

export function toLookPostModerationResultDto(args: {
  id: string
  action: LookPostModerationAction
  status: LookPostStatus
  moderationStatus: ModerationStatus
  archivedAt: Date | null
  removedAt: Date | null
}): LookPostModerationResultDto {
  return {
    target: {
      kind: 'LOOK_POST',
      id: args.id,
    },
    action: args.action,
    result: {
      id: args.id,
      status: args.status,
      moderationStatus: args.moderationStatus,
      archivedAt: toIso(args.archivedAt),
      removedAt: toIso(args.removedAt),
    },
  }
}

export function toLookCommentModerationResultDto(args: {
  id: string
  lookPostId: string
  action: LookCommentModerationAction
  moderationStatus: ModerationStatus
  commentsCount: number
}): LookCommentModerationResultDto {
  return {
    target: {
      kind: 'LOOK_COMMENT',
      id: args.id,
      lookPostId: args.lookPostId,
    },
    action: args.action,
    result: {
      id: args.id,
      lookPostId: args.lookPostId,
      moderationStatus: args.moderationStatus,
      commentsCount: args.commentsCount,
    },
  }
}

export function toViralRequestModerationResultDto(args: {
  id: string
  action: ViralRequestModerationAction
  request: ViralRequestDto
  notifications?: ViralRequestApprovalNotificationsDto
}): ViralRequestModerationResultDto {
  return {
    target: {
      kind: 'VIRAL_SERVICE_REQUEST',
      id: args.id,
    },
    action: args.action,
    result: {
      request: args.request,
      ...(args.notifications
        ? {
            notifications: args.notifications,
          }
        : {}),
    },
  }
}

export function toLegacyViralRequestApproveResponseDto(args: {
  request: ViralRequestDto
  notifications: ViralRequestApprovalNotificationsDto
}): LegacyViralRequestApproveResponseDto {
  return {
    request: args.request,
    notifications: args.notifications,
  }
}

export function toLegacyViralRequestRejectResponseDto(args: {
  request: ViralRequestDto
}): LegacyViralRequestRejectResponseDto {
  return {
    request: args.request,
  }
}