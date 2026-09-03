import {
  BoardType,
  BookingStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  LookPostStatus,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import { normalizeBoardAnswers } from '@/lib/boards/context'
import type {
  ConsultIntakePrefillProvenanceDTO,
  ConsultIntakePrefillSignalDTO,
  ConsultIntakePrefillSourceDTO,
  ConsultIntakePrefillSuggestionDTO,
  ConsultIntakeRevisionDTO,
  ConsultIntakeStateDTO,
} from '@/lib/dto/consult'
import { cosineSimilarity } from '@/lib/looks/personalizedRanking'
import {
  fetchClientTasteVector,
  fetchLookPostEmbeddings,
} from '@/lib/personalization/lookEmbeddingStore'
import { normalizeSelfProfile } from '@/lib/personalization/selfProfile'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor } from './anchor'
import { ConsultWriteError } from './errors'
import {
  evaluateConsultIntakeProgress,
  normalizeConsultIntakePayloadForPack,
  toConsultIntakeQuestionPackDTO,
} from './intake/registry'
import { SERVICE_TIMING_QUESTION_KEYS } from './intake/sharedOptions'
import type { ConsultIntakePackDefinition } from './intake/types'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'

const INTAKE_READABLE_STATES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.INTAKE_READY,
  ConsultSessionStatus.INTAKE_IN_PROGRESS,
  ConsultSessionStatus.MEDIA_READY,
])

const INTAKE_SCOPE_SELECT = {
  id: true,
  status: true,
  ...CONSULT_ANCHOR_SELECT,
  // The anchor rule reads the slug; the service profile reads the family and
  // the name as well, so the wider select replaces the anchor's narrower one.
  serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
} satisfies Prisma.ConsultSessionSelect

type IntakeScope = Prisma.ConsultSessionGetPayload<{
  select: typeof INTAKE_SCOPE_SELECT
}>

async function lockSensitiveRead(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "ConsultSession"
    WHERE "id" = ${consultSessionId}
    FOR SHARE
  `)
  if (locked.length === 0) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
}

async function requireOwnedEligibleScope(
  tx: Prisma.TransactionClient,
  args: { consultSessionId: string; clientId: string; now: Date },
): Promise<IntakeScope> {
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: INTAKE_SCOPE_SELECT,
  })
  if (!session || session.clientId !== args.clientId) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }

  const anchor = evaluateConsultAnchor(session, args.now)
  if (!anchor.eligible) {
    throw new ConsultWriteError(
      anchor.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
      'Consult is unavailable for this booking.',
    )
  }
  return session
}

type SuggestionAccumulator = {
  value: string
  provenance: ConsultIntakePrefillProvenanceDTO[]
}

function addSuggestion(
  suggestions: Map<string, SuggestionAccumulator>,
  questionKey: string,
  value: string,
  provenance: ConsultIntakePrefillProvenanceDTO,
) {
  const current = suggestions.get(questionKey)
  if (!current) {
    suggestions.set(questionKey, { value, provenance: [provenance] })
    return
  }
  if (
    current.value === value &&
    !current.provenance.some(
      (source) =>
        source.source === provenance.source &&
        source.sourceId === provenance.sourceId,
    )
  ) {
    current.provenance.push(provenance)
  }
}

function bookingTimingValue(scheduledFor: Date, now: Date): string {
  const elapsedDays = Math.max(
    0,
    Math.floor((now.getTime() - scheduledFor.getTime()) / (24 * 60 * 60 * 1000)),
  )
  if (elapsedDays <= 28) return 'within-4-weeks'
  if (elapsedDays <= 92) return '1-3-months'
  if (elapsedDays <= 183) return '4-6-months'
  if (elapsedDays <= 366) return '7-12-months'
  return 'over-12-months'
}

const SAVED_LOOK_COLOR_TAGS: Readonly<Record<string, string>> = {
  blonde: 'blonde',
  blondehair: 'blonde',
  brunette: 'brunette',
  blackhair: 'black',
  redhair: 'red',
  copper: 'red',
  vivid: 'fantasy',
  fantasycolor: 'fantasy',
  vividhair: 'fantasy',
}

function signal(
  source: ConsultIntakePrefillSourceDTO,
  available: boolean,
): ConsultIntakePrefillSignalDTO {
  return { source, available }
}

function mapLatestRevision(
  pack: ConsultIntakePackDefinition,
  revisions: Array<{
    id: string
    revision: number
    payload: Prisma.JsonValue
    createdAt: Date
  }>,
): ConsultIntakeRevisionDTO | null {
  for (const revision of revisions) {
    // Only revisions written under the pack this session SERVES count. A
    // category whose family changed mid-consult starts its intake over rather
    // than mixing two packs' answers.
    const payload = normalizeConsultIntakePayloadForPack(pack, revision.payload)
    if (!payload) continue
    return {
      id: revision.id,
      revision: revision.revision,
      ...payload,
      createdAt: revision.createdAt.toISOString(),
    }
  }
  return null
}

/**
 * Reads only owner-scoped, approved signals after both current legal versions
 * are proven. The transaction performs no writes to any source record.
 */
export async function loadConsultIntakeState(args: {
  consultSessionId: string
  clientId: string
  now?: Date
}): Promise<ConsultIntakeStateDTO> {
  const now = args.now ?? new Date()
  return prisma.$transaction(
    async (tx) => {
      await lockSensitiveRead(tx, args.consultSessionId)
      const session = await requireOwnedEligibleScope(tx, { ...args, now })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      if (!INTAKE_READABLE_STATES.has(session.status)) {
        throw new ConsultWriteError(
          'INVALID_STATE',
          'Consult lifecycle does not permit intake access.',
        )
      }
      const pack = resolveConsultServiceProfile(session.serviceCategory).intakePack
      const packAsks = (questionKey: string) =>
        pack.questions.some((question) => question.key === questionKey)
      // The one "when was your last service?" key THIS pack asks, if any —
      // the booking-history prefill lands there (values are shared).
      const serviceTimingKey =
        SERVICE_TIMING_QUESTION_KEYS.find((key) => packAsks(key)) ?? null

      const [profile, boards, savedLooks, bookingHistory, latestRevision] =
        await Promise.all([
          tx.clientProfile.findUnique({
            where: { id: args.clientId },
            select: { selfProfile: true },
          }),
          tx.board.findMany({
            where: { clientId: args.clientId, type: BoardType.COLOR_TRANSFORMATION },
            select: { id: true, answers: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 10,
          }),
          tx.boardItem.findMany({
            where: {
              board: { clientId: args.clientId },
              lookPost: {
                status: LookPostStatus.PUBLISHED,
                moderationStatus: ModerationStatus.APPROVED,
              },
            },
            select: {
              lookPostId: true,
              lookPost: {
                select: {
                  tags: {
                    where: { bannedAt: null },
                    select: { slug: true },
                    orderBy: { slug: 'asc' },
                  },
                },
              },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 20,
          }),
          // The client's last COMPLETED booking in this consult's own category,
          // whatever the category is.
          tx.booking.findFirst({
            where: {
              clientId: args.clientId,
              status: BookingStatus.COMPLETED,
              service: { categoryId: session.serviceCategoryId },
            },
            select: { id: true, scheduledFor: true },
            orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
          }),
          // C1 allowed opaque INTAKE payloads before this versioned pack
          // existed. Walk newest-first and return the latest one that conforms
          // to the current normalized contract.
          tx.consultRevision.findMany({
            where: {
              consultSessionId: session.id,
              kind: ConsultRevisionKind.INTAKE,
            },
            select: { id: true, revision: true, payload: true, createdAt: true },
            orderBy: { revision: 'desc' },
          }),
        ])
      const [tasteVector, savedLookEmbeddings] = await Promise.all([
        fetchClientTasteVector(tx, args.clientId),
        fetchLookPostEmbeddings(
          tx,
          savedLooks.map((savedLook) => savedLook.lookPostId),
        ),
      ])

      const suggestions = new Map<string, SuggestionAccumulator>()
      const selfProfile = normalizeSelfProfile(profile?.selfProfile)
      if (selfProfile?.hair_color) {
        addSuggestion(suggestions, 'current_color', selfProfile.hair_color, {
          source: 'SELF_PROFILE',
          sourceId: args.clientId,
        })
      }

      let boardSignalAvailable = false
      for (const board of boards) {
        const answers = normalizeBoardAnswers(
          BoardType.COLOR_TRANSFORMATION,
          board.answers,
        )
        if (!answers) continue
        boardSignalAvailable = true
        const boardMappings = [
          ['current_color', 'current_color'],
          ['dream_color', 'desired_color'],
          ['change_scale', 'change_scale'],
        ] as const
        for (const [boardKey, intakeKey] of boardMappings) {
          const value = answers[boardKey]
          if (value) {
            addSuggestion(suggestions, intakeKey, value, {
              source: 'BOARD',
              sourceId: board.id,
            })
          }
        }
      }

      let savedLookSignalAvailable = false
      const tasteRankedSavedLooks = [...savedLooks].sort((left, right) => {
        if (!tasteVector) return 0
        const leftEmbedding = savedLookEmbeddings.get(left.lookPostId)
        const rightEmbedding = savedLookEmbeddings.get(right.lookPostId)
        const leftScore = leftEmbedding
          ? cosineSimilarity(tasteVector.embedding, leftEmbedding)
          : -1
        const rightScore = rightEmbedding
          ? cosineSimilarity(tasteVector.embedding, rightEmbedding)
          : -1
        return rightScore - leftScore
      })
      for (const savedLook of tasteRankedSavedLooks) {
        for (const tag of savedLook.lookPost.tags) {
          const value = SAVED_LOOK_COLOR_TAGS[tag.slug]
          if (!value) continue
          savedLookSignalAvailable = true
          addSuggestion(suggestions, 'desired_color', value, {
            source: 'SAVED_LOOK',
            sourceId: savedLook.lookPostId,
          })
          if (tasteVector && savedLookEmbeddings.has(savedLook.lookPostId)) {
            addSuggestion(suggestions, 'desired_color', value, {
              source: 'TASTE_VECTOR',
              sourceId: null,
            })
          }
        }
      }

      if (bookingHistory && serviceTimingKey) {
        addSuggestion(
          suggestions,
          serviceTimingKey,
          bookingTimingValue(bookingHistory.scheduledFor, now),
          { source: 'BOOKING_HISTORY', sourceId: bookingHistory.id },
        )
      }

      // Suggestions are kept only for questions THIS pack asks, with a value
      // the question offers — so colour signals simply fall away on a pack
      // that never asks about colour.
      const prefillSuggestions: ConsultIntakePrefillSuggestionDTO[] = []
      for (const definition of pack.questions) {
        const suggestion = suggestions.get(definition.key)
        if (!suggestion) continue
        if (
          !definition.options.some(
            (option) => option.value === suggestion.value,
          )
        ) {
          continue
        }
        prefillSuggestions.push({
          questionKey: definition.key,
          value: suggestion.value,
          provenance: suggestion.provenance.slice(0, 5),
        })
      }

      const mappedLatestRevision = mapLatestRevision(pack, latestRevision)
      return {
        consultId: session.id,
        status: session.status,
        questionPack: toConsultIntakeQuestionPackDTO(pack),
        progress: evaluateConsultIntakeProgress(
          pack,
          mappedLatestRevision?.answers ?? {},
        ),
        prefillSuggestions,
        // A signal family counts as "informed prefill" only when this pack
        // asks the question it feeds.
        prefillSignals: [
          signal(
            'SELF_PROFILE',
            Boolean(selfProfile?.hair_color) && packAsks('current_color'),
          ),
          signal('BOARD', boardSignalAvailable && packAsks('desired_color')),
          signal(
            'SAVED_LOOK',
            savedLookSignalAvailable && packAsks('desired_color'),
          ),
          signal(
            'TASTE_VECTOR',
            Boolean(tasteVector && tasteVector.signalCount > 0) &&
              packAsks('desired_color'),
          ),
          signal('BOOKING_HISTORY', Boolean(bookingHistory && serviceTimingKey)),
        ],
        latestRevision: mappedLatestRevision,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
