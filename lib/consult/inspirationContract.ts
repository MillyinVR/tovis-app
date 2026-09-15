import { LOOK_ANALYSIS_ASSET_SELECT, type LookAnalysisAsset } from '@/lib/looks/analysis/identity'
import { loadReusableLookAnalysis } from '@/lib/looks/analysis/cache'
import { consultLookPlanningEnabled, hasConsultLookPlanMinimumIntake } from './lookPlanning'
import { normalizeConsultIntakePayload } from './intake/registry'
import 'server-only'

import { resolveVisualDialogueQuestion } from './inspiration/visualDialogue'

import { createHash } from 'node:crypto'
import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultInspirationSource,
  ConsultInspirationStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
  Role,
} from '@prisma/client'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'
import type {
  ConsultInspirationAnswerDTO,
  ConsultInspirationAnalysisDTO,
  ConsultInspirationCardDTO,
  ConsultInspirationCatalogGuidanceDTO,
  ConsultInspirationExactDetailDTO,
  ConsultInspirationSourceDTO,
  ConsultInspirationStateDTO,
  ConsultInspirationUploadDTO,
} from '@/lib/dto/consult'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'
import { MEDIA_SIGNED_URL_TTL_SECONDS, renderMediaUrls } from '@/lib/media/renderUrls'
import { prisma } from '@/lib/prisma'

import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { isAiConsultC6ExposureEnabledForPro } from './access'
import {
  assertConsultInputOpen,
  assertConsultReadableScope,
  CONSULT_OPEN_WINDOW_SELECT,
} from './openWindow'
import { ConsultWriteError } from './errors'
import {
  applyConsultInspirationReopen,
  consultInspirationQuestionLabel,
  deriveConsultInspirationCatalogDetails,
  evaluateConsultInspirationProgress as evaluateConsultInspirationProgressV2,
  findConsultInspirationPack,
  consultInspirationAnswerMap,
  resolveConsultInspirationPack,
  resolveConsultSessionInspirationPack,
  toConsultInspirationJsonPayloadV2,
  validateConsultInspirationAnswer as validateConsultInspirationAnswerV2,
} from './inspiration/registry'
import {
  buildConsultInspirationCards,
  composeConsultInspirationUnderstanding,
  deriveConsultInspirationPreferences,
  findConsultInspirationCardQuestion,
  type ConsultInspirationClientPreferences,
} from './inspiration/cards'
import type {
  ConsultInspirationCatalogDetail,
  ConsultInspirationPackDefinition,
  ConsultInspirationPayloadV2,
} from './inspiration/types'
import {
  buildExactClientDetails,
  buildPossibleProfessionalInterpretation,
  CONSULT_INSPIRATION_QUESTIONS,
  CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT,
  CONSULT_INSPIRATION_SCHEMA_VERSION,
  evaluateConsultInspirationProgress,
  mapStoredInspirationRevision,
  toInspirationJsonPayload,
  validateConsultInspirationAnswer,
  type InspirationReviewPayload,
} from './inspirationPack'
import {
  CONSULT_INSPIRATION_BUCKET,
  CONSULT_INSPIRATION_MAX_BYTES,
  CONSULT_INSPIRATION_READ_TTL_SECONDS,
  CONSULT_INSPIRATION_UPLOAD_TTL_MS,
  ConsultInspirationStorageError,
  consultInspirationObjectPath,
  consultInspirationStorage,
  type ConsultInspirationStorage,
} from './inspirationStorage'
import { CONSULT_CAPTURE_MEDIA_TYPES, type ConsultCaptureMediaType } from './captureVision'
import { CONSULT_INSPIRATION_ANALYSIS_READABLE_VERSIONS } from './inspirationVision'
import { normalizeStoredConsultInspirationAnalysis } from './inspirationAnalysisRead'
import { composeConsultInspirationCredibilityClientNote } from './inspirationCredibility'
import { CONSULT_MAX_CAPTURE_SHOTS } from './capture/registry'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'
import {
  appendLockedConsultInspirationRevision,
  transitionLockedConsultSession,
} from './writeBoundary'

type ClientActor = { type: typeof ConsultActorType.CLIENT; id: string }

// P7a-1: the coarse cards moved to their intended position — after consent,
// before the early photo — so the window opens one state earlier. MEDIA_READY
// stays in it: the fine PREP cards are answered there, and a consult that was
// already past the early stage when this shipped must keep working.
const MUTABLE_STATUSES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.EARLY_PHOTO_READY,
  ConsultSessionStatus.MEDIA_READY,
  // P7a-3: the prep cards stay answerable after the plan exists. Changing one
  // is exactly the input a rerun is FOR — "actually, not the length, just the
  // colour" is the most valuable thing a client can tell a pro, and until now
  // the only moment she could say it was before she had seen anything.
  ConsultSessionStatus.ANALYSIS_PENDING,
  ConsultSessionStatus.ANALYZING,
  ConsultSessionStatus.COMPLETED,
])
const READABLE_STATUSES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.EARLY_PHOTO_READY,
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
  ConsultSessionStatus.ANALYZING,
  ConsultSessionStatus.COMPLETED,
])

const SCOPE_SELECT = {
  id: true,
  status: true,
  client: { select: { userId: true } },
  // P5d: the understanding check names the professional ("We'll help Susie
  // work out the details"), so the step needs her public display name. Read
  // through the display-name SSOT's OWN select, never a hand-rolled twin —
  // that is how a pro who chose to show as @handle ends up named by her
  // business name on one screen out of ten.
  professional: { select: professionalPublicDisplayNameSelect },
  ...CONSULT_OPEN_WINDOW_SELECT,
  // The anchor rule reads the slug; the service profile — which decides WHICH
  // inspiration pack this consult serves — reads the family and the name as
  // well, so the wider select replaces the anchor's narrower one.
  serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
  // P7a-3: `totalDurationMinutes` used to be added here for the inspiration
  // use-expiry; the open-window select carries it now (the retention deadline
  // measures from the END of the appointment), so this is one field in one
  // place rather than two selects that must agree.
  booking: { select: CONSULT_OPEN_WINDOW_SELECT.booking.select },
} satisfies Prisma.ConsultSessionSelect

type InspirationScope = Prisma.ConsultSessionGetPayload<{
  select: typeof SCOPE_SELECT
}>

const ACTIVE_SOURCE_STATUSES = [
  ConsultInspirationStatus.UPLOAD_PENDING,
  ConsultInspirationStatus.ATTACHED,
] as const

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function key(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 128) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid idempotency key.')
  }
  return normalized
}

function checksum(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid checksum.')
  }
  return normalized
}

function mediaType(value: unknown): ConsultCaptureMediaType {
  const found = CONSULT_CAPTURE_MEDIA_TYPES.find((candidate) => candidate === value)
  if (!found) throw new ConsultWriteError('INVALID_REQUEST', 'Unsupported content type.')
  return found
}

/**
 * The client must echo the schema version she was SERVED, which since P5c is
 * the one belonging to the contract THIS consult is on — a v1 consult keeps
 * echoing 1 for the rest of its life, a v2 one echoes its pack's version.
 * Both clients read it off the state they were just given
 * (`ConsultInspirationStateDTO.schemaVersion`), so neither has a version
 * compiled into it.
 */
function requireSchemaVersion(
  value: number,
  pack: ConsultInspirationPackDefinition | null,
): void {
  if (value !== (pack ? pack.schemaVersion : CONSULT_INSPIRATION_SCHEMA_VERSION)) {
    throw new ConsultWriteError(
      'INSPIRATION_SCHEMA_VERSION_MISMATCH',
      'The inspiration schema version is stale.',
    )
  }
}

/**
 * The consult row lock. Exported since P5b: the inspiration READ stage takes
 * the same lock from `inspirationAnalysisContract`, and a second copy of this
 * query beside it is exactly the duplication that lets one caller drift to a
 * different lock mode without anyone noticing.
 */
export async function lockConsultSessionRow(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  mode: 'SHARE' | 'UPDATE',
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ConsultSession"
    WHERE "id" = ${consultSessionId}
    ${mode === 'SHARE' ? Prisma.raw('FOR SHARE') : Prisma.raw('FOR UPDATE')}
  `)
  if (rows.length === 0) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
}

async function requireScope(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    actorUserId: string
    now: Date
    mutation: boolean
  },
): Promise<InspirationScope> {
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: SCOPE_SELECT,
  })
  if (
    !session ||
    session.clientId !== args.clientId ||
    session.client.userId !== args.actorUserId
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  }
  // P7a-3: SCOPE only. The appointment rule moved to the WRITE paths
  // (`assertConsultInputOpen`) so that a consult which can no longer be changed
  // can still be read — before this split, a passed appointment threw out of
  // every stage loader and `optionalStage` erased the thread's own history.
  assertConsultReadableScope(session)
  if (
    (args.mutation && !MUTABLE_STATUSES.has(session.status)) ||
    (!args.mutation && !READABLE_STATUSES.has(session.status))
  ) {
    throw new ConsultWriteError('INVALID_STATE', 'Inspiration is unavailable.')
  }
  // P7a-3: one place, because this function already knows which callers write.
  if (args.mutation) assertConsultInputOpen(session, args.now)
  return session
}

/**
 * How long an uploaded inspiration photo may be USED for.
 *
 * A booking-anchored consult keys this to the appointment: the pro may look at
 * the reference until a day after the visit ends. A look-anchored consult has
 * no appointment yet (the booking proposal is B4), so it gets a fixed window
 * from the upload instead — long enough to finish the consult and read the
 * results, short enough that a private client upload is not parked
 * indefinitely on a consult that never becomes a visit.
 */
export const CONSULT_LOOK_ANCHOR_INSPIRATION_USE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function useExpiresAt(session: InspirationScope, now: Date): Date {
  if (!session.booking) {
    return new Date(now.getTime() + CONSULT_LOOK_ANCHOR_INSPIRATION_USE_TTL_MS)
  }
  return new Date(
    session.booking.scheduledFor.getTime() +
      session.booking.totalDurationMinutes * 60_000 +
      24 * 60 * 60 * 1000,
  )
}

async function activeSource(tx: Prisma.TransactionClient, consultSessionId: string) {
  return tx.consultInspiration.findFirst({
    where: { consultSessionId, status: { in: [...ACTIVE_SOURCE_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

async function latestReview(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  copy: BrandClientConsultInspirationCopy = defaultClientConsultInspirationCopy,
) {
  const revisions = await tx.consultRevision.findMany({
    where: { consultSessionId, kind: ConsultRevisionKind.INSPIRATION },
    select: { id: true, revision: true, payload: true, createdAt: true },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  for (const revision of revisions) {
    const mapped = mapStoredInspirationRevision(revision, copy)
    if (mapped) return mapped
  }
  return null
}

/**
 * P4 widened the return: the analysis now needs the REVIEW itself, not just
 * its id, so the client's own words about her reference can travel into the
 * analysis prompt beside the vision read of it. `revisionId` keeps its
 * meaning and its callers.
 */
export type CompletedConsultInspiration = {
  revisionId: string
  source: ConsultInspirationSourceDTO
  inspirationId: string | null
  answers: readonly ConsultInspirationAnswerDTO[]
  /**
   * P5c: her selections already rendered as words, and the label of the
   * question each came from.
   *
   * The analysis prompt used to rebuild both by running the raw answers back
   * through the hard-coded hair-colour question list — which produced nothing
   * at all for any other pack. Derivation belongs to whichever contract wrote
   * the row, so it happens once, here, where the contract is known.
   */
  exactClientDetails: readonly ConsultInspirationExactDetailDTO[]
  /** Question key -> the label the client actually saw. */
  questionLabels: Readonly<Record<string, string>>
  /**
   * P5d — what her CARD taps said, as four lists the analysis prompt reads:
   * what she wants, what she does not, what she was unsure about, and what she
   * asked to be left alone.
   *
   * Derived here, from her answers and the reading they were about, because
   * this is where the contract that wrote the row is known. A contract-v1
   * consult produces four empty lists — it had no cards — and the prompt falls
   * back to the same `answers` block it has always rendered.
   */
  preferences: ConsultInspirationClientPreferences
}

export async function requireCompletedConsultInspiration(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    now: Date
  },
): Promise<CompletedConsultInspiration> {
  const review = await latestReview(tx, args.consultSessionId)
  if (!review?.complete) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration is incomplete.',
    )
  }
  const latestActiveAcceptance = await tx.consultAgreementAcceptance.findFirst({
    where: { consultSessionId: args.consultSessionId, revokedAt: null },
    select: { acceptedAt: true },
    orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
  })
  if (
    !latestActiveAcceptance ||
    new Date(review.createdAt).getTime() < latestActiveAcceptance.acceptedAt.getTime()
  ) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration must be completed after current consent.',
    )
  }
  const questionLabels: Record<string, string> = {}
  const pack =
    typeof review.packId === 'string' && typeof review.packVersion === 'number'
      ? findConsultInspirationPack(review.packId, review.packVersion)
      : null
  if (pack) {
    for (const question of pack.questions) {
      // A card carries no inline label — its words are brand copy, resolved by
      // the same function that put them on the client's screen, so the brief
      // and the prompt quote the question she was actually asked.
      questionLabels[question.key] = consultInspirationQuestionLabel(
        pack,
        question,
        defaultClientConsultInspirationCopy,
      )
    }
  } else {
    for (const question of CONSULT_INSPIRATION_QUESTIONS) {
      questionLabels[question.key] = question.label
    }
  }
  // The reading her card answers were about. Read here rather than passed in
  // because the caller (the analysis prerequisites) has no reason to know that
  // a want is an attribute and a value rather than a word.
  const reading =
    pack && review.inspirationId
      ? (await inspirationAnalysisReading(tx, args.consultSessionId, review.inspirationId))
          ?.attributes ?? null
      : null
  if (pack?.adaptiveVisualDialogue && review.source !== 'NONE' &&
    !evaluateConsultInspirationProgressV2(pack, answerMap(review.answers), defaultClientConsultInspirationCopy, null, reading).canComplete) {
    throw new ConsultWriteError('ANALYSIS_PREREQUISITES_REQUIRED', 'Confirm the current visual preferences first.')
  }
  const completed: CompletedConsultInspiration = {
    revisionId: review.revisionId,
    source: review.source,
    inspirationId: review.inspirationId,
    answers: review.answers,
    exactClientDetails: review.exactClientDetails,
    questionLabels,
    preferences: pack
      ? deriveConsultInspirationPreferences({
          pack,
          reading,
          copy: defaultClientConsultInspirationCopy,
          answers: answerMap(review.answers),
        })
      : { wants: [], avoids: [], unsure: [], keep: [] },
  }
  if (review.source === 'NONE') return completed
  const source = await tx.consultInspiration.findFirst({
    where: {
      id: review.inspirationId ?? '',
      consultSessionId: args.consultSessionId,
      status: ConsultInspirationStatus.ATTACHED,
    },
  })
  const available = source?.source === ConsultInspirationSource.EXTERNAL_UPLOAD
    ? Boolean(source.storagePath && !source.purgedAt && source.useExpiresAt && source.useExpiresAt > args.now)
    : Boolean(source?.sourceLookPostId && (await lookAvailableToBoth(tx, {
        lookPostId: source.sourceLookPostId,
        clientId: args.clientId,
        professionalId: args.professionalId,
      })).available)
  if (!available) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration source is unavailable.',
    )
  }
  return completed
}

/**
 * P5b — the scope check the inspiration READ stage runs, in the file that owns
 * the inspiration step's rules.
 *
 * It is the mutation scope (`MEDIA_READY` only) plus current consent, and
 * nothing else: whether there is a readable reference is
 * `resolveLockedConsultInspirationReadTarget`'s answer, and asking it twice
 * would be two copies of the visibility rules.
 *
 * Exported rather than inlined in `inspirationAnalysisContract.ts` because
 * `requireScope` — the anchor eligibility, the readable/mutable window, the
 * ownership comparison — is this file's contract, and a second hand-rolled
 * copy beside the analysis artefact is exactly how the two drift.
 *
 * 🔴 The pilot scope switch (`AI_CONSULT_SERVICE_SCOPE`) is NOT re-checked
 * here, and that is not an omission: it gates whether a consult exists for a
 * category at all (lib/consult/eligibility.ts via `isConsultCategoryInScope`),
 * so a session reaching this function is already inside the pilot. Tori's
 * 2026-09-05 decision was to keep the pre-booking read behind the existing
 * switch and add no new gate.
 */
export async function requireLockedConsultInspirationStageScope(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    actorUserId: string
    now: Date
  },
): Promise<InspirationScope> {
  const session = await requireScope(tx, { ...args, mutation: true })
  await requireCurrentConsultAgreementAcceptances(tx, session.id)
  return session
}

/** The single cross-step readiness boundary. Either capture or inspiration may
 * finish last; both call here while holding the ConsultSession row lock.
 * Auto-advance (the default) still requires the full accepted pack; the
 * client-initiated partial submission (Tori, 2026-08-27) passes
 * minimumAcceptedShots: 1 through proceedConsultCaptureToAnalysis. */
/**
 * The SLOT KEYS of the pack the session serves (lib/consult/capture/registry.ts).
 *
 * Both readiness questions are answered from this one resolution — how many
 * accepted shots are required, and which accepted shots count towards that.
 * They were one number before P7a-1; the early photo made the second question
 * real, and deriving both from the same place is what stops them disagreeing.
 */
async function packShotKeysForSession(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<ReadonlySet<string>> {
  const session = await tx.consultSession.findUnique({
    where: { id: consultSessionId },
    select: {
      serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
    },
  })
  if (!session) {
    // Unreachable through the locked callers, and fail-safe if it ever is: an
    // empty set requires nothing to match, so the count below still gates.
    return new Set()
  }
  return new Set(
    resolveConsultServiceProfile(session.serviceCategory).capturePack.shots.map(
      (shot) => shot.key,
    ),
  )
}

export async function advanceLockedConsultToAnalysisIfReady(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    actor: ClientActor
    now: Date
  },
  options?: { minimumAcceptedShots?: number },
): Promise<boolean> {
  // 🔴 P7a-3: only a consult that is still ON ITS WAY to the analysis advances.
  //
  // This is called from the capture-accept path, which a COMPLETED consult can
  // now reach — she added a better photo to a plan she already has. Left alone
  // it tried to run MEDIA_READY -> ANALYSIS_PENDING on a session that is
  // COMPLETED, and the write boundary refused with "no longer in MEDIA_READY",
  // turning a perfectly good new photograph into a failed upload.
  //
  // What her photo triggers instead is a debounced RERUN, recorded by the same
  // caller a few lines earlier (lib/consult/analysisRerun.ts).
  const advancing = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: { status: true, serviceCategory: { select: { consultFamily: true } } },
  })
  const earlyPlan = consultLookPlanningEnabled() && advancing?.serviceCategory.consultFamily === 'HAIR'
  if (!advancing || (advancing.status !== ConsultSessionStatus.MEDIA_READY &&
    !(earlyPlan && advancing.status === ConsultSessionStatus.INTAKE_IN_PROGRESS))) return false
  if (earlyPlan) {
    const latestIntake = await tx.consultRevision.findFirst({
      where: { consultSessionId: args.consultSessionId, kind: 'INTAKE' },
      select: { payload: true }, orderBy: { revision: 'desc' },
    })
    const intake = latestIntake ? normalizeConsultIntakePayload(latestIntake.payload) : null
    if (!intake || (!intake.complete && !hasConsultLookPlanMinimumIntake(intake))) return false
  }

  try {
    await requireCompletedConsultInspiration(tx, args)
  } catch (error) {
    if (
      error instanceof ConsultWriteError &&
      error.code === 'ANALYSIS_PREREQUISITES_REQUIRED'
    ) {
      return false
    }
    throw error
  }
  const captures = await tx.consultCapture.findMany({
    where: {
      consultSessionId: args.consultSessionId,
      status: ConsultCaptureStatus.ACCEPTED,
      purgedAt: null,
      rawExpiresAt: { gt: args.now },
    },
    select: { shotKey: true },
  })
  // 🔴 The EARLY PHOTO is excluded, and it is the reason this is a filter and
  // not a plain Set (P7a-1). It is an accepted capture and a legitimate
  // analysis input, but it is not one of the pack's slots — counting it made a
  // seven-shot hair consult "complete" after SIX guided photos, which advanced
  // the session to ANALYSIS_PENDING and then refused the seventh. Pack
  // completeness counts pack slots; "is there anything analysable at all" is a
  // different question, asked elsewhere.
  const packShotKeys = await packShotKeysForSession(tx, args.consultSessionId)
  const accepted = new Set(
    captures
      .map(({ shotKey }) => shotKey)
      .filter((shotKey) => packShotKeys.has(shotKey) || (earlyPlan && shotKey === 'early_photo')),
  )
  // A full pack is THIS session's pack — the seven hair views, or the three of
  // the face and area packs. The default used to be the LARGEST pack (seven),
  // which is fail-safe for the hair pilot and wrong for every other family: a
  // three-shot consult whose inspiration finished last could never reach seven
  // and sat in MEDIA_READY forever. The capture and inspiration callers now
  // share this one resolution; only the explicit partial-submit door passes
  // its own (smaller) threshold.
  const minimumAcceptedShots =
    options?.minimumAcceptedShots ??
    (earlyPlan ? 1 : (packShotKeys.size || CONSULT_MAX_CAPTURE_SHOTS))
  if (accepted.size < minimumAcceptedShots) {
    return false
  }
  await transitionLockedConsultSession(tx, {
    consultSessionId: args.consultSessionId,
    actor: args.actor,
    fromStatus: advancing.status,
    toStatus: ConsultSessionStatus.ANALYSIS_PENDING,
  })
  return true
}

async function lookAvailableToBoth(
  tx: Prisma.TransactionClient,
  args: {
    lookPostId: string
    clientId: string
    professionalId: string
  },
): Promise<{
  available: boolean
  source: 'PLATFORM_LOOK' | 'BOOKED_PRO_LOOK' | null
}> {
  const [clientAccess, professionalAccess] = await Promise.all([
    loadLookAccess(tx, {
      lookPostId: args.lookPostId,
      viewerClientId: args.clientId,
    }),
    loadLookAccess(tx, {
      lookPostId: args.lookPostId,
      viewerProfessionalId: args.professionalId,
    }),
  ])
  if (!clientAccess || !professionalAccess) return { available: false, source: null }
  const clientCanView = canViewLookPost(
    buildLookPolicyInput(clientAccess, Role.CLIENT),
  )
  const professionalCanView = canViewLookPost(
    buildLookPolicyInput(professionalAccess, Role.PRO),
  )
  if (!clientCanView || !professionalCanView) {
    return { available: false, source: null }
  }
  return {
    available: true,
    source:
      clientAccess.look.professionalId === args.professionalId &&
      clientAccess.look.clientAuthorId === null
        ? 'BOOKED_PRO_LOOK'
        : 'PLATFORM_LOOK',
  }
}

/**
 * What the image-visibility rules actually read off the session. Narrower than
 * `InspirationScope` on purpose: the analysis path (P4) reaches these rules
 * with its own, smaller select, and widening its select just to satisfy a type
 * would be loading rows nothing uses.
 */
export type ConsultInspirationImageScope = {
  id: string
  clientId: string
  professionalId: string
}

async function imageAvailable(
  tx: Prisma.TransactionClient,
  source: Awaited<ReturnType<typeof activeSource>>,
  session: ConsultInspirationImageScope,
  now: Date,
): Promise<boolean> {
  if (!source || source.status !== ConsultInspirationStatus.ATTACHED) return false
  if (source.source === ConsultInspirationSource.EXTERNAL_UPLOAD) {
    return Boolean(
      source.storageBucket === CONSULT_INSPIRATION_BUCKET &&
        source.storagePath &&
        !source.purgedAt &&
        source.useExpiresAt &&
        source.useExpiresAt.getTime() > now.getTime(),
    )
  }
  if (!source.sourceLookPostId) return false
  return (
    await lookAvailableToBoth(tx, {
      lookPostId: source.sourceLookPostId,
      clientId: session.clientId,
      professionalId: session.professionalId,
    })
  ).available
}

/**
 * P5b — the reading of THIS reference, if the vision model has made one.
 *
 * Matched on the inspiration ROW plus the artefact's two version columns, so a
 * reading stored under a superseded schema or prompt reads as absent and the
 * client asks for a current one. Those are the same two constants
 * `normalizeStoredConsultInspirationAnalysis` checks.
 *
 * 🔴 P5d widened it from a boolean to the artefact itself, and that is what
 * makes the cards possible: a card's crop is one of these attributes' regions
 * and its words are looked up by the attribute's VALUE. `analysisReady` on the
 * wire is still just "is there one" — the raw enums stay server-side, because
 * they are a colourist's description of somebody else's hair and the client
 * has no use for them.
 *
 * Deliberately a column-and-payload query here rather than a call into
 * `inspirationAnalysisContract`: that module imports this one, and reading a
 * row is not worth a cycle between them. `normalizeStoredConsultInspirationAnalysis`
 * is shared (./inspirationAnalysisRead), so the two callers cannot drift about
 * what a valid artefact is.
 */
async function inspirationAnalysisReading(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  inspirationId: string,
): Promise<ConsultInspirationAnalysisDTO | null> {
  const stored = await tx.consultRevision.findFirst({
    where: {
      consultSessionId,
      kind: ConsultRevisionKind.INSPIRATION_ANALYSIS,
      // 🔴 C2-6b: every READABLE version pair, not only the current one. The
      // normalizer below checks the same list, so the query cannot return a
      // row the normalizer then refuses. Newest first, so once a photograph
      // has been re-read under v4 that reading wins over its v3 one.
      OR: CONSULT_INSPIRATION_ANALYSIS_READABLE_VERSIONS.map((readable) => ({
        schemaVersion: readable.schemaVersion,
        promptVersion: readable.promptVersion,
      })),
      payload: { path: ['inspirationId'], equals: inspirationId },
    },
    select: {
      id: true,
      payload: true,
      schemaVersion: true,
      promptVersion: true,
      model: true,
      createdAt: true,
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  if (!stored) return null
  return normalizeStoredConsultInspirationAnalysis(stored)
}

/**
 * P5c — WHICH CONTRACT this consult's guided inspiration is on.
 *
 * A session that has already written a contract-v1 inspiration stays on v1 for
 * the rest of its life (`null`), because switching a client mid-flow would
 * refuse her stored answers as "no inspiration", re-ask everything in a
 * different vocabulary, and reject her next tap with a schema mismatch she has
 * no way to resolve. Everyone else — every consult that has written nothing
 * yet, and every consult already on v2 — gets a PACK, at the version it
 * started on.
 *
 * Newest-first, because the pin is whatever the LATEST readable revision says.
 */
async function sessionInspirationPack(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
): Promise<ConsultInspirationPackDefinition | null> {
  const currentPack = resolveConsultInspirationPack({
    categorySlug: session.serviceCategory.slug,
    family: session.serviceCategory.consultFamily,
  })
  const revisions = await tx.consultRevision.findMany({
    where: { consultSessionId: session.id, kind: ConsultRevisionKind.INSPIRATION },
    select: { payload: true },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  return resolveConsultSessionInspirationPack(
    currentPack,
    revisions.map((revision) => revision.payload),
  )
}

/** Her stored answers as the v2 engine reads them: question key -> values. */
const answerMap = consultInspirationAnswerMap

type InspirationStateContext = {
  /** Null when this consult is on contract v1. */
  pack: ConsultInspirationPackDefinition | null
  copy: BrandClientConsultInspirationCopy
  /**
   * P5d — the professional's public display name, for the understanding
   * check's closing line. Resolved through the display-name SSOT.
   */
  professionalDisplayName: string
}

/**
 * The contract this consult is on, plus the sentences to render it with.
 *
 * `copy` defaults to the brand's default table, and the CONSULT THREAD
 * (lib/consult/thread.ts) is what passes a tenant's own — the same division
 * the capture step already uses. The standalone `/inspiration` routes stay on
 * the default deliberately: resolving a tenant there would put a database
 * lookup that can THROW in front of a route that has already made a paid
 * provider call (P5b's `/inspiration/read`), and turn a successful reading
 * into a 500. The thread is where a client reads these sentences.
 */
async function inspirationStateContext(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
  copy: BrandClientConsultInspirationCopy | undefined,
): Promise<InspirationStateContext> {
  return {
    pack: await sessionInspirationPack(tx, session),
    copy: copy ?? defaultClientConsultInspirationCopy,
    professionalDisplayName: formatProfessionalPublicDisplayName(
      session.professional,
      // The step's own warm fallback, matching the thread's: a pro with no
      // usable name token reads as "your professional", never "Professional".
      'your professional',
    ),
  }
}


async function buildState(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
  now: Date,
  ctx: InspirationStateContext,
): Promise<ConsultInspirationStateDTO> {
  const { pack, copy } = ctx
  const [source, review] = await Promise.all([
    activeSource(tx, session.id),
    latestReview(tx, session.id, copy),
  ])
  // 🔴 The reading, not just "is there one". Every card below is a crop of it,
  // and a card is built ONLY where it settled something — which is what makes
  // a light-blonde reference incapable of producing a copper question.
  const stored = source
    ? await inspirationAnalysisReading(tx, session.id, source.id)
    : null
  const reading = stored?.attributes ?? null
  // C2-6b — the app's one sentence about the photograph, when the reading
  // flagged it. Composed here, where the tenant's copy is in hand, so the
  // thread carries a finished sentence and no code.
  const credibilityNote = stored
    ? composeConsultInspirationCredibilityClientNote(stored.credibilityFlags ?? [], copy)
    : null
  const sourceState = source
    ? {
        inspirationId: source.id,
        source: source.source,
        lookPostId: source.sourceLookPostId,
        // 🔴 `imageReadEndpoint` is a TYPED contract, not a link: whatever it
        // names must answer `{ url, expiresInSeconds }`
        // (`ConsultInspirationSignedReadResponseDTO`). It used to fork on the
        // source and point look-anchored consults at `/api/v1/looks/{id}`,
        // which answers a whole look DTO — no `url`, no `expiresInSeconds`.
        // Web read `undefined` off it and scheduled its next refresh from
        // `NaN` (a setTimeout(NaN) fires immediately → a refetch loop), and
        // iOS's endpoint guard refused it and swallowed the throw, which is
        // B4: a look-anchored consult asks "what did you like about it?" with
        // nothing on screen. ONE route, ONE shape, both sources.
        imageReadEndpoint: `/api/v1/client/consult/${encodeURIComponent(session.id)}/inspiration/media`,
        imageAvailable: await imageAvailable(tx, source, session, now),
        useExpiresAt: source.useExpiresAt?.toISOString() ?? null,
        analysisReady: reading !== null,
      }
    : null

  // The step's own sentences, and the version the client must echo back. Both
  // come from the contract this consult is on: a v1 consult keeps being asked
  // v1's questions at v1's schema version, whatever the current pack is.
  const shell = {
    schemaVersion: pack ? pack.schemaVersion : CONSULT_INSPIRATION_SCHEMA_VERSION,
    introduction: copy.introduction,
    referenceNote: copy.referenceNote,
    reflectionPrompt: pack ? copy[pack.reflectionPromptKey] : copy.reflectionPromptHair,
  }
  // 🔴 Contract v2 has NO detail gate — that is the P5c change. A v1 consult
  // still reports (and is still held to) three.
  const requiredSpecificDetailCount = pack ? 0 : CONSULT_INSPIRATION_REQUIRED_DETAIL_COUNT

  if (!review && !sourceState) {
    return {
      consultId: session.id,
      status: session.status,
      ...shell,
      source: null,
      progress: {
        currentQuestion: null,
        answeredQuestionCount: 0,
        specificDetailCount: 0,
        requiredSpecificDetailCount,
        canComplete: false,
        blocker: 'SOURCE_DECISION_REQUIRED',
      },
      latestReview: null,
    }
  }

  const activeReview =
    review &&
    (review.source === 'NONE' || review.inspirationId === sourceState?.inspirationId)
      ? review
      : null
  const answers = activeReview?.answers ?? []
  const answersByKey = answerMap(answers)
  // Her own words on any answered question, in question order — never a model observation.
  const clientWords = answers.flatMap((answer) => (answer.text ? [answer.text] : []))
  // The understanding check's text is composed per client from her own taps
  // and what the photograph did not settle, so it has to be built before the
  // progress that serves it as the current question.
  const understanding = pack
    ? composeConsultInspirationUnderstanding({
        pack,
        answers: answersByKey,
        reading,
        copy,
        professionalDisplayName: ctx.professionalDisplayName,
        clientWords,
      })
    : null
  const progress = pack
    ? evaluateConsultInspirationProgressV2(pack, answersByKey, copy, understanding, reading)
    : evaluateConsultInspirationProgress(answers)
  const cards = pack
    ? buildConsultInspirationCards({
        pack,
        reading,
        copy,
        professionalDisplayName: ctx.professionalDisplayName,
        clientWords,
        answers: answersByKey,
      })
    : { coarse: [], prep: [] }
  return {
    consultId: session.id,
    status: session.status,
    ...shell,
    source: sourceState,
    progress:
      activeReview?.source === 'NONE'
        ? {
            currentQuestion: null,
            nextPrepQuestionKey: null,
            answeredQuestionCount: 0,
            specificDetailCount: 0,
            requiredSpecificDetailCount,
            canComplete: true,
            blocker: null,
          }
        : {
            ...progress,
            requiredSpecificDetailCount,
          },
    // A consult that skipped the reference has nothing to crop, so it has no
    // cards — the same reason it has no questions. Nor a note about it.
    credibilityNote: activeReview?.source === 'NONE' ? null : credibilityNote,
    cards: activeReview?.source === 'NONE' ? [] : [
      ...cards.coarse.filter((card) => !pack?.adaptiveVisualDialogue ||
        ((card.selectedValues.length > 0 || answers.some(answer => answer.questionKey === card.questionKey && answer.text)) && (card.questionKey !== 'understanding_check' || progress.canComplete)) ||
        card.questionKey === progress.currentQuestion?.key),
      ...cards.prep,
    ].map(card => ({ ...card, selectedText: answers.find(answer => answer.questionKey === card.questionKey)?.text ?? null })),
    latestReview: activeReview,
  }
}

/**
 * What a guided-inspiration write puts in the row: contract v1's payload for a
 * consult that started on it, contract v2's for everyone else. The two are
 * carried as a discriminated union rather than a wide object so a caller
 * cannot build half of each.
 */
type InspirationWrite =
  | { contract: 1; payload: InspirationReviewPayload }
  | { contract: 2; payload: ConsultInspirationPayloadV2 }

async function appendReview(
  tx: Prisma.TransactionClient,
  args: {
    session: InspirationScope
    actor: ClientActor
    idempotencyKey: string
    requestHash: string
    write: InspirationWrite
  },
) {
  const { write } = args
  return appendLockedConsultInspirationRevision(tx, {
    consultSessionId: args.session.id,
    payload:
      write.contract === 1
        ? toInspirationJsonPayload(write.payload)
        : (toConsultInspirationJsonPayloadV2(
            write.payload,
          ) as Prisma.InputJsonValue),
    // The ROW's schema version, which the database guard branches on to pick
    // which contract's rules to apply.
    schemaVersion:
      write.contract === 1
        ? CONSULT_INSPIRATION_SCHEMA_VERSION
        : write.payload.schemaVersion,
    idempotencyKey: args.idempotencyKey,
    requestHash: args.requestHash,
    actor: args.actor,
  })
}

async function replaceActiveSource(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  now: Date,
  actor: ClientActor,
) {
  const current = await activeSource(tx, consultSessionId)
  if (!current) return null
  await tx.consultInspiration.update({
    where: { id: current.id },
    data: {
      status: ConsultInspirationStatus.REPLACED,
      ...(current.source === ConsultInspirationSource.EXTERNAL_UPLOAD && !current.purgedAt
        ? { purgeEligibleAt: now, purgeRequestedAt: now }
        : {}),
    },
  })
  await tx.consultAuditEvent.create({
    data: {
      consultSessionId,
      action: ConsultAuditAction.INSPIRATION_REMOVED,
      actorType: actor.type,
      actorId: actor.id,
      inspirationId: current.id,
    },
  })
  return current
}

export async function loadConsultInspirationState(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
  copy?: BrandClientConsultInspirationCopy
}): Promise<ConsultInspirationStateDTO> {
  const now = args.now ?? new Date()
  return prisma.$transaction(
    async (tx) => {
      await lockConsultSessionRow(tx, args.consultSessionId, 'SHARE')
      const session = await requireScope(tx, { ...args, now, mutation: false })
      await requireCurrentConsultAgreementAcceptances(tx, session.id)
      return buildState(
        tx,
        session,
        now,
        await inspirationStateContext(tx, session, args.copy),
      )
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}

export async function chooseConsultInspirationLook(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  /** The tenant's inspiration copy. Defaults to the brand default table. */
  copy?: BrandClientConsultInspirationCopy
  input: {
    idempotencyKey: string
    schemaVersion: number
    source: 'PLATFORM_LOOK' | 'BOOKED_PRO_LOOK'
    lookPostId: string
  }
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const ctx = await inspirationStateContext(tx, session, args.copy)
    requireSchemaVersion(args.input.schemaVersion, ctx.pack)
    const idempotencyKey = key(args.input.idempotencyKey)
    const lookPostId = args.input.lookPostId.trim()
    if (!lookPostId) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid Look.')
    const requestHash = hash({
      source: args.input.source,
      lookPostId,
      schemaVersion: args.input.schemaVersion,
    })
    const existing = await tx.consultInspiration.findFirst({
      where: { consultSessionId: session.id, sourceIdempotencyKey: idempotencyKey },
    })
    if (existing) {
      if (existing.sourceRequestHash !== requestHash) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
      }
      return { state: await buildState(tx, session, now, ctx), replayed: true }
    }
    const access = await lookAvailableToBoth(tx, {
      lookPostId,
      clientId: session.clientId,
      professionalId: session.professionalId,
    })
    if (!access.available || access.source !== args.input.source) {
      throw new ConsultWriteError('INSPIRATION_LOOK_UNAVAILABLE', 'Look unavailable.')
    }
    await replaceActiveSource(tx, session.id, now, args.actor)
    const created = await tx.consultInspiration.create({
      data: {
        consultSessionId: session.id,
        source: args.input.source,
        status: ConsultInspirationStatus.ATTACHED,
        sourceLookPostId: lookPostId,
        sourceIdempotencyKey: idempotencyKey,
        sourceRequestHash: requestHash,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.INSPIRATION_SOURCE_SELECTED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        inspirationId: created.id,
      },
    })
    return { state: await buildState(tx, session, now, ctx), replayed: false }
  })
}

export async function skipConsultInspiration(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  /** The tenant's inspiration copy. Defaults to the brand default table. */
  copy?: BrandClientConsultInspirationCopy
  input: { idempotencyKey: string; schemaVersion: number }
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const result = await prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const ctx = await inspirationStateContext(tx, session, args.copy)
    requireSchemaVersion(args.input.schemaVersion, ctx.pack)
    const idempotencyKey = key(args.input.idempotencyKey)
    const requestHash = hash({ source: 'NONE', schemaVersion: args.input.schemaVersion })
    const existing = await tx.consultRevision.findFirst({
      where: { consultSessionId: session.id, idempotencyKey },
    })
    if (existing) {
      if (
        existing.kind !== ConsultRevisionKind.INSPIRATION ||
        existing.requestHash !== requestHash
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
      }
      return {
        state: await buildState(tx, session, now, ctx),
        replayed: true,
        previous: null,
      }
    }
    const previous = await replaceActiveSource(tx, session.id, now, args.actor)
    // A skipped reference is complete the moment she skips it, under whichever
    // contract this consult is on. Both shapes say the same thing: no source,
    // no answers, done.
    const appended = await appendReview(tx, {
      session,
      actor: args.actor,
      idempotencyKey,
      requestHash,
      write: ctx.pack
        ? {
            contract: 2,
            payload: {
              packId: ctx.pack.id,
              packVersion: ctx.pack.version,
              schemaVersion: ctx.pack.schemaVersion,
              source: 'NONE',
              inspirationId: null,
              complete: true,
              answers: {},
              catalogGuidance: [],
            },
          }
        : {
            contract: 1,
            payload: {
              contractId: 'hair-color-guided-inspiration',
              contractVersion: 1,
              schemaVersion: 1,
              source: 'NONE',
              inspirationId: null,
              complete: true,
              answers: [],
              exactClientDetails: [],
              possibleProfessionalInterpretation: [],
              catalogGuidance: [],
            },
          },
    })
    const advanced = await advanceLockedConsultToAnalysisIfReady(tx, {
      consultSessionId: session.id,
      clientId: session.clientId,
      professionalId: session.professionalId,
      actor: args.actor,
      now,
    })
    return {
      state: await buildState(
        tx,
        advanced
          ? { ...session, status: ConsultSessionStatus.ANALYSIS_PENDING }
          : session,
        now,
        ctx,
      ),
      replayed: appended.replayed,
      previous,
    }
  })
  if (result.previous?.source === ConsultInspirationSource.EXTERNAL_UPLOAD) {
    await purgeConsultInspirationObject(result.previous.id, now).catch(() => undefined)
  }
  return { state: result.state, replayed: result.replayed }
}

export async function issueConsultInspirationUpload(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  /** The tenant's inspiration copy. Defaults to the brand default table. */
  copy?: BrandClientConsultInspirationCopy
  input: {
    idempotencyKey: string
    schemaVersion: number
    contentType: unknown
    sizeBytes: number
    checksumSha256: string | null
  }
  storage?: ConsultInspirationStorage
}): Promise<{ upload: ConsultInspirationUploadDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultInspirationStorage
  return prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const ctx = await inspirationStateContext(tx, session, args.copy)
    requireSchemaVersion(args.input.schemaVersion, ctx.pack)
    const idempotencyKey = key(args.input.idempotencyKey)
    const contentType = mediaType(args.input.contentType)
    if (
      !Number.isInteger(args.input.sizeBytes) ||
      args.input.sizeBytes < 1 ||
      args.input.sizeBytes > CONSULT_INSPIRATION_MAX_BYTES
    ) {
      throw new ConsultWriteError('INVALID_REQUEST', 'Invalid inspiration size.')
    }
    const checksumSha256 = checksum(args.input.checksumSha256)
    const requestHash = hash({
      schemaVersion: args.input.schemaVersion,
      contentType,
      sizeBytes: args.input.sizeBytes,
      checksumSha256,
    })
    let inspiration = await tx.consultInspiration.findFirst({
      where: { consultSessionId: session.id, sourceIdempotencyKey: idempotencyKey },
    })
    const replayed = Boolean(inspiration)
    if (inspiration) {
      if (
        inspiration.sourceRequestHash !== requestHash ||
        inspiration.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
        inspiration.status !== ConsultInspirationStatus.UPLOAD_PENDING ||
        !inspiration.storagePath ||
        !inspiration.uploadExpiresAt ||
        inspiration.uploadExpiresAt.getTime() <= now.getTime() ||
        inspiration.purgedAt
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Upload unavailable.')
      }
    } else {
      await replaceActiveSource(tx, session.id, now, args.actor)
      inspiration = await tx.consultInspiration.create({
        data: {
          consultSessionId: session.id,
          source: ConsultInspirationSource.EXTERNAL_UPLOAD,
          status: ConsultInspirationStatus.UPLOAD_PENDING,
          storageBucket: CONSULT_INSPIRATION_BUCKET,
          storagePath: consultInspirationObjectPath(contentType),
          contentType,
          sizeBytes: args.input.sizeBytes,
          checksumSha256,
          sourceIdempotencyKey: idempotencyKey,
          sourceRequestHash: requestHash,
          uploadExpiresAt: new Date(now.getTime() + CONSULT_INSPIRATION_UPLOAD_TTL_MS),
          useExpiresAt: useExpiresAt(session, now),
        },
      })
      await tx.consultAuditEvent.create({
        data: {
          consultSessionId: session.id,
          action: ConsultAuditAction.INSPIRATION_UPLOAD_ISSUED,
          actorType: args.actor.type,
          actorId: args.actor.id,
          inspirationId: inspiration.id,
        },
      })
    }
    if (!inspiration.storagePath || !inspiration.uploadExpiresAt || !inspiration.useExpiresAt) {
      throw new ConsultWriteError('INSPIRATION_UPLOAD_MISMATCH', 'Upload unavailable.')
    }
    try {
      await storage.assertReady()
      const signed = await storage.createSignedUpload(inspiration.storagePath)
      return {
        upload: {
          inspirationId: inspiration.id,
          schemaVersion: CONSULT_INSPIRATION_SCHEMA_VERSION,
          contentType,
          maxBytes: inspiration.sizeBytes ?? args.input.sizeBytes,
          expiresAt: inspiration.uploadExpiresAt.toISOString(),
          useExpiresAt: inspiration.useExpiresAt.toISOString(),
          token: signed.token,
          signedUrl: signed.signedUrl,
        },
        replayed,
      }
    } catch (error) {
      if (error instanceof ConsultInspirationStorageError) {
        throw new ConsultWriteError(
          'INSPIRATION_STORAGE_UNAVAILABLE',
          'Private inspiration storage is unavailable.',
        )
      }
      throw error
    }
  })
}

export async function attachConsultInspirationUpload(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  /** The tenant's inspiration copy. Defaults to the brand default table. */
  copy?: BrandClientConsultInspirationCopy
  input: { idempotencyKey: string; inspirationId: string; schemaVersion: number }
  storage?: ConsultInspirationStorage
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultInspirationStorage
  return prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const ctx = await inspirationStateContext(tx, session, args.copy)
    requireSchemaVersion(args.input.schemaVersion, ctx.pack)
    const idempotencyKey = key(args.input.idempotencyKey)
    const inspirationId = args.input.inspirationId.trim()
    const requestHash = hash({ inspirationId, schemaVersion: args.input.schemaVersion })
    const inspiration = await tx.consultInspiration.findFirst({
      where: { id: inspirationId, consultSessionId: session.id },
    })
    if (!inspiration) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
    if (inspiration.status === ConsultInspirationStatus.ATTACHED) {
      if (
        inspiration.attachIdempotencyKey !== idempotencyKey ||
        inspiration.attachRequestHash !== requestHash
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Attach conflict.')
      }
      return { state: await buildState(tx, session, now, ctx), replayed: true }
    }
    if (
      inspiration.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
      inspiration.status !== ConsultInspirationStatus.UPLOAD_PENDING ||
      !inspiration.uploadExpiresAt ||
      inspiration.uploadExpiresAt.getTime() <= now.getTime() ||
      inspiration.purgedAt ||
      !inspiration.storagePath ||
      !inspiration.contentType ||
      !inspiration.sizeBytes
    ) {
      throw new ConsultWriteError('INSPIRATION_UPLOAD_EXPIRED', 'Upload expired.')
    }
    const contentType = mediaType(inspiration.contentType)
    try {
      await storage.assertReady()
      const inspected = await storage.inspectObject({
        path: inspiration.storagePath,
        expectedContentType: contentType,
        maxBytes: inspiration.sizeBytes,
        expectedChecksumSha256: inspiration.checksumSha256,
      })
      if (inspected.sizeBytes !== inspiration.sizeBytes) {
        throw new ConsultInspirationStorageError('invalid')
      }
    } catch (error) {
      if (error instanceof ConsultInspirationStorageError) {
        throw new ConsultWriteError(
          error.kind === 'unavailable'
            ? 'INSPIRATION_STORAGE_UNAVAILABLE'
            : 'INSPIRATION_OBJECT_INVALID',
          'Inspiration object unavailable.',
        )
      }
      throw error
    }
    const updated = await tx.consultInspiration.update({
      where: { id: inspiration.id },
      data: {
        status: ConsultInspirationStatus.ATTACHED,
        attachIdempotencyKey: idempotencyKey,
        attachRequestHash: requestHash,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.INSPIRATION_UPLOAD_ATTACHED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        inspirationId: updated.id,
      },
    })
    return { state: await buildState(tx, session, now, ctx), replayed: false }
  })
}

/**
 * Which of the catalogue details she pointed at this professional could
 * actually mean — matched against her LIVE menu, so the note is never shown
 * for a service she does not offer.
 *
 * Returns ENUMS. The sentence that goes with them is brand copy
 * (`catalogGuidanceNote`), filled in on READ: a contract-v2 payload stores the
 * enums alone, which is what lets that sentence be edited — or white-labelled —
 * without rewriting stored rows.
 */
async function catalogDetailsOfferedByPro(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
  requested: readonly ConsultInspirationCatalogDetail[],
): Promise<ConsultInspirationCatalogDetail[]> {
  if (requested.length === 0) return []
  const offerings = await tx.professionalServiceOffering.findMany({
    where: {
      professionalId: session.professionalId,
      isActive: true,
      service: { isActive: true, category: { isActive: true } },
    },
    select: {
      service: { select: { name: true, description: true, category: { select: { name: true, slug: true } } } },
    },
  })
  const text = offerings.map((offering) =>
    `${offering.service.name} ${offering.service.description ?? ''} ${offering.service.category.name} ${offering.service.category.slug}`,
  )
  const patterns: Readonly<Record<ConsultInspirationCatalogDetail, RegExp>> = {
    LENGTH: /\b(cut|trim|length|extension)\b/i,
    FULLNESS: /\b(extension|volume|fullness|thick)\b/i,
    STYLING: /\b(style|styling|blowout|finish|curl|wave)\b/i,
  }
  return requested.filter((detail) =>
    text.some((value) => patterns[detail].test(value)),
  )
}

/** The contract-v1 catalogue block: the same details, with the sentence in the row. */
async function catalogGuidance(
  tx: Prisma.TransactionClient,
  session: InspirationScope,
  answers: readonly ConsultInspirationAnswerDTO[],
  copy: BrandClientConsultInspirationCopy,
): Promise<ConsultInspirationCatalogGuidanceDTO[]> {
  const details = buildExactClientDetails(answers)
  const requested: ConsultInspirationCatalogDetail[] = []
  if (details.some((detail) => detail.questionKey === 'length_goal')) requested.push('LENGTH')
  if (details.some((detail) => detail.questionKey === 'fullness_goal')) requested.push('FULLNESS')
  if (
    details.some(
      (detail) =>
        detail.questionKey === 'current_styling' ||
        detail.questionKey === 'styling_walkthrough',
    )
  ) {
    requested.push('STYLING')
  }
  const offered = await catalogDetailsOfferedByPro(tx, session, requested)
  return offered.map((detail) => ({
    detail,
    message: copy.catalogGuidanceNote,
    contextOnly: true as const,
    automaticallyAdded: false as const,
  }))
}

/**
 * One answer, validated against the contract THIS consult is on.
 *
 * The two contracts disagree about what an answer even is: v1 carries free
 * text and a sentiment on its `other_detail` question, v2 carries keys and
 * enum values and nothing else. Deciding once, here, is what keeps the write
 * path from growing two half-parallel branches that could each drift.
 */
type ValidatedInspirationAnswer =
  | { contract: 1; answer: ConsultInspirationAnswerDTO }
  | { contract: 2; questionKey: string; selectedValues: string[]; text: string | null }

function validateAnswerForContract(
  pack: ConsultInspirationPackDefinition | null,
  input: {
    questionKey: unknown
    selectedValues: unknown
    text?: unknown
    sentiment?: unknown
  },
): ValidatedInspirationAnswer {
  if (!pack) {
    try {
      return { contract: 1, answer: validateConsultInspirationAnswer(input) }
    } catch {
      throw new ConsultWriteError('INSPIRATION_INVALID_ANSWER', 'Invalid answer.')
    }
  }
  // V2 accepts bounded client words while legacy sentiment remains unsupported.
  const validated =
    input.sentiment == null
      ? validateConsultInspirationAnswerV2(pack, input)
      : ({ ok: false } as const)
  if (!validated.ok) {
    throw new ConsultWriteError('INSPIRATION_INVALID_ANSWER', 'Invalid answer.')
  }
  return {
    contract: 2,
    questionKey: validated.questionKey,
    selectedValues: validated.selectedValues,
    text: validated.text,
  }
}

export async function answerConsultInspirationQuestion(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  /** The tenant's inspiration copy. Defaults to the brand default table. */
  copy?: BrandClientConsultInspirationCopy
  input: {
    idempotencyKey: string
    schemaVersion: number
    questionKey: unknown
    selectedValues: unknown
    text?: unknown
    sentiment?: unknown
  }
}): Promise<{ state: ConsultInspirationStateDTO; replayed: boolean }> {
  const now = args.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const ctx = await inspirationStateContext(tx, session, args.copy)
    requireSchemaVersion(args.input.schemaVersion, ctx.pack)
    const source = await activeSource(tx, session.id)
    if (!source || source.status !== ConsultInspirationStatus.ATTACHED) {
      throw new ConsultWriteError('INSPIRATION_SOURCE_REQUIRED', 'Select a source first.')
    }
    if (!(await imageAvailable(tx, source, session, now))) {
      throw new ConsultWriteError('INSPIRATION_SOURCE_UNAVAILABLE', 'Source unavailable.')
    }
    const validated = validateAnswerForContract(ctx.pack, args.input)
    const idempotencyKey = key(args.input.idempotencyKey)
    // 🔴 The v1 hash input is byte-identical to what it has always been. A
    // client retrying an answer she sent before this shipped must replay, not
    // collide.
    const requestHash = hash({
      schemaVersion: args.input.schemaVersion,
      answer:
        validated.contract === 1
          ? validated.answer
          : {
              questionKey: validated.questionKey,
              selectedValues: validated.selectedValues,
              ...(args.input.text !== undefined ? { text: validated.text } : {}),
            },
    })
    const existing = await tx.consultRevision.findFirst({
      where: { consultSessionId: session.id, idempotencyKey },
    })
    if (existing) {
      if (
        existing.kind !== ConsultRevisionKind.INSPIRATION ||
        existing.requestHash !== requestHash
      ) {
        throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
      }
      return { state: await buildState(tx, session, now, ctx), replayed: true }
    }
    // `latestReview` already normalized this row; re-reading the payload to
    // normalize it a second time was one query and one code path more than the
    // answer needs.
    //
    // ⚠️ One behaviour changed with that simplification, deliberately. The
    // previous review only counts when it is about THIS reference: the old
    // code took its answers only on an id match but read `complete` off it
    // either way, so a client who had skipped, or who had finished a review of
    // a picture she then REPLACED, could answer any question first and store a
    // review holding one arbitrary answer. She is now asked the pack's first
    // question, which is what the empty answer set already implied.
    const previous = await latestReview(tx, session.id, ctx.copy)
    const previousReview = previous?.inspirationId === source.id ? previous : null
    const previousAnswers = previousReview?.answers ?? []
    const reading = ctx.pack?.adaptiveVisualDialogue
      ? (await inspirationAnalysisReading(tx, session.id, source.id))?.attributes ?? null
      : null

    let write: InspirationWrite
    if (validated.contract === 2 && ctx.pack) {
      const pack = ctx.pack
      const previousMap = answerMap(previousAnswers)
      const progress = evaluateConsultInspirationProgressV2(pack, previousMap, ctx.copy, null, reading)
      const question = findConsultInspirationCardQuestion(pack, validated.questionKey)
      if (question?.visualDialogue) {
        const applicable = resolveVisualDialogueQuestion(question, previousMap, reading)
        if (!applicable || validated.selectedValues.some((value) => !applicable.options.some((option) => option.value === value))) {
          throw new ConsultWriteError('INSPIRATION_QUESTION_OUT_OF_ORDER', 'This question or choice is not available for this reference and goal.')
        }
      }
      // 🔴 The order rule is the COARSE tier's, and only its. Prep cards are
      // asked after the booking, they never gate completion, and she may
      // answer them in any order or not at all — so holding them to "answer
      // the current question first" would refuse the second card she taps.
      // A coarse card is still strictly ordered until the tier is complete;
      // after that any card, coarse or prep, is answerable again (which is
      // what "living document until the appointment" means here).
      if (
        (!previousReview?.complete || (pack.adaptiveVisualDialogue && previousMap[validated.questionKey] === undefined)) &&
        question?.tier !== 'PREP' &&
        progress.currentQuestion?.key !== validated.questionKey
      ) {
        throw new ConsultWriteError(
          'INSPIRATION_QUESTION_OUT_OF_ORDER',
          'Answer the current question first.',
        )
      }
      // "Change something" on the understanding check clears the cards it
      // reopens AND itself, so the check comes back around with the corrected
      // summary instead of standing as an agreement she withdrew.
      const answers: Record<string, readonly string[]> = question
        ? applyConsultInspirationReopen(question, validated.selectedValues, previousMap)
        : { ...previousMap, [validated.questionKey]: validated.selectedValues }
      const textAnswers: Record<string, string> = Object.fromEntries(previousAnswers
        .filter(answer => answer.text && answers[answer.questionKey] !== undefined)
        .map(answer => [answer.questionKey, answer.text!]))
      if (validated.text && answers[validated.questionKey] !== undefined) textAnswers[validated.questionKey] = validated.text
      else if (args.input.text !== undefined) delete textAnswers[validated.questionKey]
      write = {
        contract: 2,
        payload: {
          packId: pack.id,
          packVersion: pack.version,
          schemaVersion: pack.schemaVersion,
          source: source.source,
          inspirationId: source.id,
          complete: evaluateConsultInspirationProgressV2(pack, answers, ctx.copy, null, reading)
            .canComplete,
          answers,
          ...(Object.keys(textAnswers).length ? { textAnswers } : {}),
          // Enums only. The sentence is filled in on read from brand copy.
          catalogGuidance: await catalogDetailsOfferedByPro(
            tx,
            session,
            deriveConsultInspirationCatalogDetails(pack, answers),
          ),
        },
      }
    } else if (validated.contract === 1) {
      const answer = validated.answer
      const progress = evaluateConsultInspirationProgress(previousAnswers)
      if (
        !previousReview?.complete &&
        progress.currentQuestion?.key !== answer.questionKey
      ) {
        throw new ConsultWriteError(
          'INSPIRATION_QUESTION_OUT_OF_ORDER',
          'Answer the current question first.',
        )
      }
      const answers = previousAnswers.filter(
        (candidate) => candidate.questionKey !== answer.questionKey,
      )
      const order = new Map(
        CONSULT_INSPIRATION_QUESTIONS.map((question, index) => [question.key, index]),
      )
      answers.push(answer)
      answers.sort(
        (left, right) =>
          (order.get(left.questionKey) ?? 0) - (order.get(right.questionKey) ?? 0),
      )
      const exactClientDetails = buildExactClientDetails(answers)
      write = {
        contract: 1,
        payload: {
          contractId: 'hair-color-guided-inspiration',
          contractVersion: 1,
          schemaVersion: 1,
          source: source.source,
          inspirationId: source.id,
          complete: evaluateConsultInspirationProgress(answers).canComplete,
          answers,
          exactClientDetails,
          possibleProfessionalInterpretation:
            buildPossibleProfessionalInterpretation(exactClientDetails),
          catalogGuidance: await catalogGuidance(tx, session, answers, ctx.copy),
        },
      }
    } else {
      // Unreachable: `validateAnswerForContract` returns contract 2 only when a
      // pack was passed. Refusing rather than assuming, because an unreachable
      // state that silently passes is the shape of every guard that stopped
      // guarding.
      throw new ConsultWriteError('INSPIRATION_INVALID_ANSWER', 'Invalid answer.')
    }

    const appended = await appendReview(tx, {
      session,
      actor: args.actor,
      idempotencyKey,
      requestHash,
      write,
    })
    const advanced = write.payload.complete
      ? await advanceLockedConsultToAnalysisIfReady(tx, {
          consultSessionId: session.id,
          clientId: session.clientId,
          professionalId: session.professionalId,
          actor: args.actor,
          now,
        })
      : false
    return {
      state: await buildState(
        tx,
        advanced
          ? { ...session, status: ConsultSessionStatus.ANALYSIS_PENDING }
          : session,
        now,
        ctx,
      ),
      replayed: appended.replayed,
    }
  })
}

export async function purgeConsultInspirationObject(
  inspirationId: string,
  now = new Date(),
  storage: ConsultInspirationStorage = consultInspirationStorage,
): Promise<boolean> {
  const candidate = await prisma.consultInspiration.findUnique({
    where: { id: inspirationId },
  })
  if (
    !candidate ||
    candidate.source !== ConsultInspirationSource.EXTERNAL_UPLOAD ||
    candidate.purgedAt
  ) {
    return false
  }
  if (!candidate.storagePath) throw new Error('Unpurged inspiration has no pointer.')
  await storage.assertReady()
  await storage.purgeObject(candidate.storagePath)
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ConsultInspiration"
      WHERE "id" = ${candidate.id} FOR UPDATE
    `)
    if (locked.length === 0) return false
    const current = await tx.consultInspiration.findUnique({ where: { id: candidate.id } })
    if (!current || current.purgedAt) return false
    if (current.storagePath !== candidate.storagePath) {
      throw new Error('Inspiration storage binding changed during purge.')
    }
    await tx.consultInspiration.update({
      where: { id: current.id },
      data: {
        storageBucket: null,
        storagePath: null,
        purgedAt: now,
        purgeEligibleAt: now,
        purgeRequestedAt: now,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: current.consultSessionId,
        action: ConsultAuditAction.INSPIRATION_RAW_PURGED,
        actorType: ConsultActorType.SYSTEM,
        actorId: null,
        inspirationId: current.id,
      },
    })
    return true
  })
}

export async function removeConsultInspiration(args: {
  consultSessionId: string
  clientId: string
  actor: ClientActor
  now?: Date
  storage?: ConsultInspirationStorage
}): Promise<void> {
  const now = args.now ?? new Date()
  const source = await prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'UPDATE')
    const session = await requireScope(tx, {
      consultSessionId: args.consultSessionId,
      clientId: args.clientId,
      actorUserId: args.actor.id,
      now,
      mutation: true,
    })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    const current = await activeSource(tx, session.id)
    if (!current) return null
    await tx.consultInspiration.update({
      where: { id: current.id },
      data: {
        status: ConsultInspirationStatus.REMOVED,
        ...(current.source === ConsultInspirationSource.EXTERNAL_UPLOAD && !current.purgedAt
          ? { purgeEligibleAt: now, purgeRequestedAt: now }
          : {}),
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: session.id,
        action: ConsultAuditAction.INSPIRATION_REMOVED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        inspirationId: current.id,
      },
    })
    return current
  })
  if (source?.source === ConsultInspirationSource.EXTERNAL_UPLOAD && !source.purgedAt) {
    try {
      await purgeConsultInspirationObject(
        source.id,
        now,
        args.storage ?? consultInspirationStorage,
      )
    } catch (error) {
      if (error instanceof ConsultInspirationStorageError) {
        throw new ConsultWriteError(
          'INSPIRATION_STORAGE_UNAVAILABLE',
          'Private inspiration storage is unavailable.',
        )
      }
      throw error
    }
  }
}

/**
 * The Look's own primary photo, as storage pointers.
 *
 * Deliberately pointers and NOT a URL: resolving them is `renderMediaUrls`'s
 * job, and it must happen OUTSIDE the transaction because a private-bucket
 * look costs a Supabase round-trip to sign. Returns null when the look or its
 * asset is gone — the caller turns that into a refusal, never into a blank
 * image.
 */
async function lookPrimaryMediaPointers(
  tx: Prisma.TransactionClient,
  lookPostId: string,
): Promise<{
  storageBucket: string | null
  storagePath: string | null
  url: string | null
  analysisAsset?: LookAnalysisAsset
  analysisFrameUrl?: string
} | null> {
  if (!lookPostId) return null
  const look = await tx.lookPost.findUnique({
    where: { id: lookPostId },
    select: {
      primaryMediaAsset: {
        select: { ...LOOK_ANALYSIS_ASSET_SELECT, url: true },
      },
    },
  })
  if (!look) return null
  const reusable = await loadReusableLookAnalysis(tx, look.primaryMediaAsset)
  return { ...look.primaryMediaAsset, analysisAsset: look.primaryMediaAsset,
    ...(reusable ? { analysisFrameUrl: `data:image/jpeg;base64,${reusable.frame.base64}` } : {}) }

}

/**
 * The ONE read behind `imageReadEndpoint`, for every inspiration source.
 *
 * Both branches answer the same `{ url, expiresInSeconds }` shape, and both
 * re-check visibility at READ time rather than trusting the state DTO that
 * carried the endpoint:
 *
 * - EXTERNAL_UPLOAD → a signed read of the client's own private object.
 * - PLATFORM_LOOK / BOOKED_PRO_LOOK → the anchoring Look's primary media,
 *   resolved through `renderMediaUrls` (signed for a private bucket, public
 *   URL for a public one). `imageAvailable` re-runs `lookAvailableToBoth`
 *   here, which is the whole reason this is a route and not a URL baked into
 *   the state DTO: a look that gets unpublished, hidden or moderated mid-
 *   consult stops resolving on the very next read, where a handed-out URL
 *   would keep working forever.
 *
 * `expiresInSeconds` is the FLOOR of the two TTLs in play, never the larger:
 * under-reporting costs one early refetch, over-reporting hands the client a
 * dark image with no scheduled recovery.
 */
/**
 * The active source resolved to something readable, WITHOUT minting a URL.
 *
 * Split out of `loadClientInspirationSignedRead` so P4's analysis path can
 * reach the same resolution from inside a transaction that already holds the
 * ConsultSession row FOR UPDATE. Calling the public function there would
 * self-deadlock: it opens its own transaction and takes FOR SHARE on the row
 * the caller is holding. One resolution, two callers, no second copy of the
 * visibility rules.
 */
export type ConsultInspirationReadTarget =
  | { kind: 'UPLOAD'; inspirationId: string; source: ConsultInspirationSource; storagePath: string }
  | {
      kind: 'LOOK'
      inspirationId: string
      source: ConsultInspirationSource
      pointers: NonNullable<Awaited<ReturnType<typeof lookPrimaryMediaPointers>>>
    }

export async function resolveLockedConsultInspirationReadTarget(
  tx: Prisma.TransactionClient,
  session: ConsultInspirationImageScope,
  now: Date,
): Promise<ConsultInspirationReadTarget> {
  const current = await activeSource(tx, session.id)
  if (!current || !(await imageAvailable(tx, current, session, now))) {
    throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  }
  if (current.source === ConsultInspirationSource.EXTERNAL_UPLOAD) {
    if (!current.storagePath) {
      throw new ConsultWriteError('NOT_FOUND', 'Not found.')
    }
    return {
      kind: 'UPLOAD',
      inspirationId: current.id,
      source: current.source,
      storagePath: current.storagePath,
    }
  }
  const pointers = await lookPrimaryMediaPointers(tx, current.sourceLookPostId ?? '')
  if (!pointers) {
    throw new ConsultWriteError(
      'INSPIRATION_LOOK_UNAVAILABLE',
      'The selected Look is unavailable.',
    )
  }
  return {
    kind: 'LOOK',
    inspirationId: current.id,
    source: current.source,
    pointers,
  }
}

/** A resolved target → the `{ url, expiresInSeconds }` both callers answer with. */
export async function mintConsultInspirationReadUrl(
  target: ConsultInspirationReadTarget,
  storage: ConsultInspirationStorage = consultInspirationStorage,
): Promise<{ url: string; expiresInSeconds: number }> {
  if (target.kind === 'LOOK') {
    if (target.pointers.analysisFrameUrl) return { url: target.pointers.analysisFrameUrl, expiresInSeconds: CONSULT_INSPIRATION_READ_TTL_SECONDS }
    const rendered = await renderMediaUrls(target.pointers)
    if (!rendered.renderUrl) {
      throw new ConsultWriteError(
        'INSPIRATION_LOOK_UNAVAILABLE',
        'The selected Look is unavailable.',
      )
    }
    return {
      url: rendered.renderUrl,
      expiresInSeconds: Math.min(
        CONSULT_INSPIRATION_READ_TTL_SECONDS,
        MEDIA_SIGNED_URL_TTL_SECONDS,
      ),
    }
  }

  try {
    await storage.assertReady()
    return {
      url: await storage.createSignedRead(
        target.storagePath,
        CONSULT_INSPIRATION_READ_TTL_SECONDS,
      ),
      expiresInSeconds: CONSULT_INSPIRATION_READ_TTL_SECONDS,
    }
  } catch (error) {
    if (error instanceof ConsultInspirationStorageError) {
      throw new ConsultWriteError(
        'INSPIRATION_STORAGE_UNAVAILABLE',
        'Private inspiration storage is unavailable.',
      )
    }
    throw error
  }
}

export async function loadClientInspirationSignedRead(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  now?: Date
  storage?: ConsultInspirationStorage
}): Promise<{ url: string; expiresInSeconds: number }> {
  const now = args.now ?? new Date()
  const target = await prisma.$transaction(async (tx) => {
    await lockConsultSessionRow(tx, args.consultSessionId, 'SHARE')
    const session = await requireScope(tx, { ...args, now, mutation: false })
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
    return resolveLockedConsultInspirationReadTarget(tx, session, now)
  })
  return mintConsultInspirationReadUrl(
    target,
    args.storage ?? consultInspirationStorage,
  )
}

export async function loadProInspirationSignedRead(args: {
  consultSessionId: string
  professionalId: string
  now?: Date
  storage?: ConsultInspirationStorage
}): Promise<{ url: string; expiresInSeconds: number }> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  }
  const now = args.now ?? new Date()
  const source = await prisma.consultInspiration.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      source: ConsultInspirationSource.EXTERNAL_UPLOAD,
      status: ConsultInspirationStatus.ATTACHED,
      purgedAt: null,
      useExpiresAt: { gt: now },
      consultSession: {
        professionalId: args.professionalId,
        status: ConsultSessionStatus.COMPLETED,
      },
    },
  })
  if (!source?.storagePath) throw new ConsultWriteError('NOT_FOUND', 'Not found.')
  try {
    const storage = args.storage ?? consultInspirationStorage
    await storage.assertReady()
    return {
      url: await storage.createSignedRead(
        source.storagePath,
        CONSULT_INSPIRATION_READ_TTL_SECONDS,
      ),
      expiresInSeconds: CONSULT_INSPIRATION_READ_TTL_SECONDS,
    }
  } catch (error) {
    if (error instanceof ConsultInspirationStorageError) {
      throw new ConsultWriteError(
        'INSPIRATION_STORAGE_UNAVAILABLE',
        'Private inspiration storage is unavailable.',
      )
    }
    throw error
  }
}

export function sourceDto(value: ConsultInspirationSource): Exclude<ConsultInspirationSourceDTO, 'NONE'> {
  return value
}
