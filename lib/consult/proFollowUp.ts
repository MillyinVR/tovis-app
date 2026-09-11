import 'server-only'

import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultProFollowUpPriority,
  ConsultSessionStatus,
  NotificationEventKey,
  type Prisma,
} from '@prisma/client'

import { defaultClientConsultProFollowUpCopy } from '@/lib/brand/defaultClientConsultProFollowUpCopy'
import type {
  ConsultInspirationQuestionOptionDTO,
  ConsultProFollowUpDTO,
  ConsultProFollowUpPriorityDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

import { countConsultPlanVersions } from './analysisRerun'
import { ConsultWriteError } from './errors'
import { requireAuthorizedProLookScope } from './lookBrief'
import { assertConsultInputOpen, CONSULT_OPEN_WINDOW_SELECT } from './openWindow'
import { requireAuthorizedProposalScope } from './proposalEntry'
import { fillConsultThreadCopy } from './threadCopy'

// C2-4 — a professional asks the client one follow-up question from the Brief.
//
// The design rule this module exists to keep: the CLIENT side is the existing
// follow-up card and the existing answer route. A question the pro typed is
// stored apart from the model's rounds (its own table, its own cap, its own
// audit actions), but it is RENDERED as a `FOLLOW_UP` thread message and
// ANSWERED through `POST /client/consult/{id}/follow-up` exactly like one —
// the `pro_` prefix on the key is how the server files the answer here. That
// is what lets an iOS build that predates this feature answer a professional's
// question on the day this deploys, with no app change. (Parity gap on that
// build: the "From {pro}" eyebrow, which rides an OPTIONAL wire field.)
//
// 🔴 What this slice does NOT do, on purpose: it does not open a plan version
// or request a rerun when the client answers. The analysis input hash does not
// include a pro question, so a rerun would rebuild the same plan; "an answer
// updates the living Brief" is the next slice, and it needs its own decision
// about what the answer feeds. Today the answer is shown on the Brief and in
// the transcript, with provenance, and the pro is told it arrived.

/** How many of a pro's questions may be OPEN on one consult at once. */
export const CONSULT_PRO_FOLLOW_UP_MAX_OPEN = 3
/** How many a pro may ask on one consult in total, answered or not. */
export const CONSULT_PRO_FOLLOW_UP_MAX_PER_CONSULT = 12
export const CONSULT_PRO_FOLLOW_UP_MAX_TEXT_LENGTH = 300
export const CONSULT_PRO_FOLLOW_UP_MAX_LABEL_LENGTH = 120
export const CONSULT_PRO_FOLLOW_UP_MIN_OPTIONS = 2
export const CONSULT_PRO_FOLLOW_UP_MAX_OPTIONS = 6

const KEY_PATTERN = /^pro_[1-9][0-9]{0,3}$/

/** The routing signal the shared answer route reads. Mirrors the DB CHECK. */
export function isConsultProFollowUpKey(questionKey: string): boolean {
  return KEY_PATTERN.test(questionKey)
}

const PRIORITIES: readonly ConsultProFollowUpPriorityDTO[] = [
  ConsultProFollowUpPriority.NEED_BEFORE_APPOINTMENT,
  ConsultProFollowUpPriority.HELPFUL_FOR_PREP,
]

export type ConsultProFollowUpAsk = {
  priority: ConsultProFollowUpPriorityDTO
  text: string
  optionLabels: string[]
}

/**
 * The request body, narrowed. Throws `INVALID_REQUEST` with a content-free
 * message on anything out of shape; the route turns that into a 400.
 *
 * Trims everything, refuses empties and duplicates, and never accepts a
 * `professionalId` — identity is the session's, always.
 */
export function parseConsultProFollowUpAsk(body: unknown): ConsultProFollowUpAsk {
  const invalid = () => new ConsultWriteError('INVALID_REQUEST', 'Invalid follow-up question.')
  if (!isRecord(body)) throw invalid()
  const priority = PRIORITIES.find((value) => value === body.priority)
  if (!priority) throw invalid()
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text.length < 1 || text.length > CONSULT_PRO_FOLLOW_UP_MAX_TEXT_LENGTH) throw invalid()
  if (!Array.isArray(body.options)) throw invalid()
  const optionLabels = body.options.map((label) =>
    typeof label === 'string' ? label.trim() : '',
  )
  if (
    optionLabels.length < CONSULT_PRO_FOLLOW_UP_MIN_OPTIONS ||
    optionLabels.length > CONSULT_PRO_FOLLOW_UP_MAX_OPTIONS ||
    optionLabels.some(
      (label) => label.length < 1 || label.length > CONSULT_PRO_FOLLOW_UP_MAX_LABEL_LENGTH,
    ) ||
    new Set(optionLabels.map((label) => label.toLowerCase())).size !== optionLabels.length
  ) {
    throw invalid()
  }
  return { priority, text, optionLabels }
}

/** Server-minted option values: `option-1`…`option-6`, the grammar the DB guard pins. */
export function mintConsultProFollowUpOptions(
  labels: readonly string[],
): ConsultInspirationQuestionOptionDTO[] {
  return labels.map((label, index) => ({ value: `option-${index + 1}`, label }))
}

/**
 * A stored `options` column, narrowed. The guard proved the shape on the way
 * in; a row that fails here was written around it, and is read as having no
 * options rather than taking the thread down.
 */
export function readStoredConsultProFollowUpOptions(
  payload: Prisma.JsonValue,
): ConsultInspirationQuestionOptionDTO[] {
  if (!Array.isArray(payload)) return []
  const out: ConsultInspirationQuestionOptionDTO[] = []
  for (const entry of payload) {
    if (!isRecord(entry) || typeof entry.value !== 'string' || typeof entry.label !== 'string') {
      return []
    }
    out.push({ value: entry.value, label: entry.label })
  }
  return out
}

const PRO_FOLLOW_UP_SELECT = {
  id: true,
  consultSessionId: true,
  professionalId: true,
  questionKey: true,
  priority: true,
  clientText: true,
  options: true,
  planVersion: true,
  selectedValue: true,
  answeredAt: true,
  createdAt: true,
} satisfies Prisma.ConsultProFollowUpQuestionSelect

type ProFollowUpRow = Prisma.ConsultProFollowUpQuestionGetPayload<{
  select: typeof PRO_FOLLOW_UP_SELECT
}>

export function projectConsultProFollowUp(row: ProFollowUpRow): ConsultProFollowUpDTO {
  const options = readStoredConsultProFollowUpOptions(row.options)
  const selected = row.selectedValue
    ? options.find((option) => option.value === row.selectedValue) ?? null
    : null
  return {
    id: row.id,
    questionKey: row.questionKey,
    priority: row.priority,
    text: row.clientText,
    options,
    selectedValue: row.selectedValue,
    selectedLabel: selected?.label ?? null,
    planVersion: row.planVersion,
    askedAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
  }
}

type Db = Prisma.TransactionClient | typeof prisma

/** Every question on the consult, oldest first. No authorization — callers hold it. */
export async function loadConsultProFollowUps(
  db: Db,
  consultSessionId: string,
): Promise<ConsultProFollowUpDTO[]> {
  const rows = await db.consultProFollowUpQuestion.findMany({
    where: { consultSessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: PRO_FOLLOW_UP_SELECT,
  })
  return rows.map(projectConsultProFollowUp)
}

/** The pro's read: the shared Brief authorization, then the list. */
export async function loadAuthorizedConsultProFollowUps(args: {
  consultSessionId: string
  professionalId: string
  actorUserId: string
}): Promise<ConsultProFollowUpDTO[]> {
  return prisma.$transaction(async (tx) => {
    await requireAuthorizedProLookScope(tx, args, { readOnly: true })
    return loadConsultProFollowUps(tx, args.consultSessionId)
  })
}

function consultHref(consultSessionId: string): string {
  return `/client/consult/${encodeURIComponent(consultSessionId)}`
}

/**
 * The pro asks. One transaction: the shared Brief authorization (which takes
 * the session lock and enforces the open window), the caps, the row, its
 * PRO_FOLLOW_UP_ASKED audit event, and the client's doorbell.
 *
 * Refusals are `ConsultWriteError`s: `NOT_FOUND` for a consult that is not
 * hers, `INVALID_STATE` for a consult with no Brief yet or one at a cap.
 */
export async function askConsultProFollowUp(
  args: {
    consultSessionId: string
    professionalId: string
    actorUserId: string
  } & ConsultProFollowUpAsk,
  deps: { now?: Date } = {},
): Promise<ConsultProFollowUpDTO[]> {
  const now = deps.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const session = await requireAuthorizedProLookScope(tx, args)
    const current = await tx.consultSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { ...CONSULT_OPEN_WINDOW_SELECT, status: true, clientId: true, bookingId: true },
    })
    // The shared scope lets a pro keep ADJUSTING during the arrival-day
    // confirmation window; asking is different. A question she cannot answer
    // any more (the client path closes at the appointment) is a dead end in
    // her thread, so the pro side closes at the same moment.
    assertConsultInputOpen(current, now)
    // A Brief is the only surface a professional asks from, and COMPLETED is
    // the only status the client's answer path admits — an earlier question
    // would be one she could see and not answer.
    if (current.status !== ConsultSessionStatus.COMPLETED) {
      throw new ConsultWriteError('INVALID_STATE', 'Consultation is not ready for a question yet.')
    }
    const [total, open] = await Promise.all([
      tx.consultProFollowUpQuestion.count({ where: { consultSessionId: session.id } }),
      tx.consultProFollowUpQuestion.count({
        where: { consultSessionId: session.id, selectedValue: null },
      }),
    ])
    if (total >= CONSULT_PRO_FOLLOW_UP_MAX_PER_CONSULT) {
      throw new ConsultWriteError('INVALID_STATE', 'This consultation has reached its question limit.')
    }
    if (open >= CONSULT_PRO_FOLLOW_UP_MAX_OPEN) {
      throw new ConsultWriteError('INVALID_STATE', 'Wait for an answer before asking another question.')
    }

    const planVersion = await countConsultPlanVersions(tx, session.id)
    const created = await tx.consultProFollowUpQuestion.create({
      data: {
        consultSessionId: session.id,
        professionalId: args.professionalId,
        // Unique per session under the lock: the count is the next ordinal.
        questionKey: `pro_${total + 1}`,
        priority: args.priority,
        // Verbatim in this slice; the supportive-voice translation is later,
        // and when it lands `proIntent` is what it translates FROM.
        proIntent: args.text,
        clientText: args.text,
        options: mintConsultProFollowUpOptions(args.optionLabels),
        planVersion,
      },
      select: PRO_FOLLOW_UP_SELECT,
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.PRO_FOLLOW_UP_ASKED,
        actorType: ConsultActorType.PROFESSIONAL,
        actorId: args.professionalId,
        proFollowUpQuestionId: created.id,
      },
    })

    // The doorbell. Never the question: it is behind a login and may be
    // health-adjacent, the same rule every consult notification keeps.
    const professional = await tx.professionalProfile.findUniqueOrThrow({
      where: { id: args.professionalId },
      select: professionalPublicDisplayNameSelect,
    })
    const pro = formatProfessionalPublicDisplayName(professional)
    const message =
      args.priority === ConsultProFollowUpPriority.NEED_BEFORE_APPOINTMENT
        ? defaultClientConsultProFollowUpCopy.askedNeeded
        : defaultClientConsultProFollowUpCopy.asked
    await upsertClientNotification({
      tx,
      clientId: current.clientId,
      eventKey: NotificationEventKey.CONSULT_PRO_FOLLOW_UP,
      title: fillConsultThreadCopy(message.title, { pro }),
      body: fillConsultThreadCopy(message.body, { pro }),
      href: consultHref(session.id),
      data: {
        consultSessionId: session.id,
        proFollowUpQuestionId: created.id,
        priority: created.priority,
        askedAt: now.toISOString(),
      },
      dedupeKey: `consult-pro-follow-up:${created.id}`,
      ...(current.bookingId ? { bookingId: current.bookingId } : {}),
    })

    return loadConsultProFollowUps(tx, session.id)
  })
}

export class ConsultProFollowUpAnswerError extends Error {
  constructor(readonly code: 'NOT_OPEN' | 'INVALID_ANSWER') {
    super('Invalid follow-up answer.')
    this.name = 'ConsultProFollowUpAnswerError'
  }
}

/**
 * The client answers. Reached ONLY through `answerConsultFollowUpQuestion`,
 * which is what the shared route calls; the `pro_` key is what sent it here.
 *
 * Same scope as the model-round branch: `requireAuthorizedProposalScope`
 * (lock, ownership, COMPLETED, anchor, live agreements) and the open window.
 * Write-once: a replay of the same tap is a no-op, a different value on an
 * answered question is refused as `NOT_OPEN` — exactly the round's rule.
 */
export async function answerConsultProFollowUp(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  questionKey: string
  selectedValue: string
  now?: Date
}): Promise<void> {
  const now = args.now ?? new Date()
  await prisma.$transaction(async (tx) => {
    await requireAuthorizedProposalScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actorUserId,
      now,
    })
    const current = await tx.consultSession.findUniqueOrThrow({
      where: { id: args.consultSessionId },
      select: CONSULT_OPEN_WINDOW_SELECT,
    })
    assertConsultInputOpen(current, now)

    const row = await tx.consultProFollowUpQuestion.findUnique({
      where: {
        consultSessionId_questionKey: {
          consultSessionId: args.consultSessionId,
          questionKey: args.questionKey,
        },
      },
      select: PRO_FOLLOW_UP_SELECT,
    })
    if (!row) throw new ConsultProFollowUpAnswerError('NOT_OPEN')
    if (row.selectedValue !== null) {
      if (row.selectedValue === args.selectedValue) return
      throw new ConsultProFollowUpAnswerError('NOT_OPEN')
    }
    const options = readStoredConsultProFollowUpOptions(row.options)
    if (!options.some((option) => option.value === args.selectedValue)) {
      throw new ConsultProFollowUpAnswerError('INVALID_ANSWER')
    }

    await tx.consultProFollowUpQuestion.update({
      where: { id: row.id },
      data: { selectedValue: args.selectedValue, answeredAt: now },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: args.consultSessionId,
        action: ConsultAuditAction.PRO_FOLLOW_UP_ANSWERED,
        actorType: ConsultActorType.CLIENT,
        actorId: args.actorUserId,
        proFollowUpQuestionId: row.id,
      },
    })
    await createProNotification({
      tx,
      professionalId: row.professionalId,
      eventKey: NotificationEventKey.CONSULT_PRO_FOLLOW_UP,
      title: defaultClientConsultProFollowUpCopy.answered.title,
      body: defaultClientConsultProFollowUpCopy.answered.body,
      href: `/pro/consults/${encodeURIComponent(args.consultSessionId)}`,
      data: {
        consultSessionId: args.consultSessionId,
        proFollowUpQuestionId: row.id,
        answeredAt: now.toISOString(),
      },
      dedupeKey: `consult-pro-follow-up-answer:${row.id}`,
      actorUserId: args.actorUserId,
    })
  })
}
