'use client'

// Web client consult wizard (2026-08-26 full-analysis launch). Drives the
// existing consult API contracts end to end: consent → intake (one question at
// a time) → inspiration → the service family's shot pack with the chart-copy choice →
// analysis → results. All legal wording, questions, and shot instructions are
// server-served; this component only renders them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useRouter } from 'next/navigation'

import type { BrandClientConsultCaptureCopy } from '@/lib/brand/types'
import { formatConsultCaptureIntro } from '@/lib/consult/captureCopy'
import { CONSULT_CAPTURE_MAX_BYTES } from '@/lib/consult/capturePack'
import {
  CONSULT_INSPIRATION_TEXT_MAX_CHARS,
  CONSULT_INSPIRATION_UNSUPPORTED_TRAIT_LANGUAGE,
} from '@/lib/consult/inspirationTextRules'
import type {
  ConsultAgreementStateDTO,
  ConsultAnalysisStateDTO,
  ConsultCaptureQualityReasonCodeDTO,
  ConsultCaptureShotDTO,
  ConsultCaptureSlotStateDTO,
  ConsultCaptureStateDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationStateDTO,
  ConsultIntakeStateDTO,
  ConsultSessionDTO,
  ConsultSessionLookupDTO,
} from '@/lib/dto/consult'
import RemoteImage from '@/app/_components/media/RemoteImage'
import {
  ImagePreparationError,
  prepareImageForUpload,
} from '@/lib/media/prepareImageForUpload'

type ApiEnvelope = { ok?: boolean; error?: string; code?: string }

class ConsultFlowApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'ConsultFlowApiError'
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  })
  let body: (T & ApiEnvelope) | null = null
  try {
    body = (await response.json()) as T & ApiEnvelope
  } catch {
    body = null
  }
  if (!response.ok || !body || body.ok === false) {
    throw new ConsultFlowApiError(
      body?.error ?? 'Something went wrong. Please try again.',
      body?.code ?? null,
    )
  }
  return body
}

function newKey(): string {
  return crypto.randomUUID()
}

async function browserSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const CARD = 'rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5'
const BUTTON_PRIMARY =
  'rounded-xl bg-textPrimary px-4 py-2.5 text-sm font-black text-bgPrimary disabled:opacity-50'
const BUTTON_SECONDARY =
  'rounded-xl border border-surfaceGlass/20 px-4 py-2.5 text-sm font-bold text-textPrimary disabled:opacity-50'
const CHIP_ACTIVE =
  'rounded-lg bg-textPrimary px-3 py-1.5 text-xs font-black text-bgPrimary disabled:opacity-50'
const CHIP_INACTIVE =
  'rounded-lg border border-surfaceGlass/20 px-3 py-1.5 text-xs font-bold text-textPrimary disabled:opacity-50'

type InspirationSentiment = 'GOOD' | 'BAD' | 'BOTH'

const SENTIMENT_OPTIONS: ReadonlyArray<{
  value: InspirationSentiment
  label: string
}> = [
  { value: 'GOOD', label: 'Something I like' },
  { value: 'BAD', label: 'Something I’d avoid' },
  { value: 'BOTH', label: 'A bit of both' },
]

// Mirrors NEUTRAL_VALUES in lib/consult/inspirationPack.ts: the server rejects
// a neutral option combined with any other selection.
const NEUTRAL_INSPIRATION_VALUES = new Set([
  'none',
  'not-sure',
  'not-part-of-goal',
  'nothing-else',
])

// Where to look in the inspiration photo for each question. Presentation-only
// guidance beside the server-served question copy.
const INSPIRATION_FOCUS: Readonly<Record<string, string>> = {
  favorite_colors:
    'Zoom into the hair and look at the mix of colors — the brightest pieces, the deepest pieces, and the tones in between.',
  avoid_colors:
    'Look over each color in the hair again — is there any you would not want on you?',
  length_goal: 'Look at where the hair ends — how long it falls.',
  fullness_goal: 'Look at how thick and full the hair appears overall.',
  current_styling:
    'Look at how the hair is styled — straight, waves, curls, or something else.',
  styling_walkthrough:
    'Think about whether you could get it styled this way on your own.',
  other_detail: 'One last look — anything else stand out, good or bad?',
}

const QUALITY_REASON_COPY: Readonly<
  Record<ConsultCaptureQualityReasonCodeDTO, string>
> = {
  PASS: 'Accepted.',
  WARM_INDOOR_LIGHT:
    'Warm indoor lighting — true colors can’t be read accurately under it.',
  COLOR_CAST: 'A color tint in the light is masking the true colors.',
  VIEW_MISMATCH: 'This doesn’t look like the view this photo asks for.',
  HAIR_NOT_VISIBLE: 'The hair isn’t clearly visible in this photo.',
  SUBJECT_NOT_VISIBLE: 'The area this photo asks for isn’t clearly visible.',
  BLURRY: 'The photo is too blurry to use.',
  TOO_DARK: 'The photo is too dark to read.',
  TOO_BRIGHT: 'The photo is too bright or washed out.',
  OTHER_QUALITY_FAILURE: 'This photo can’t be used for the analysis.',
}

function StageHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
        {eyebrow}
      </div>
      <h2 className="mt-1 text-lg font-black text-textPrimary">{title}</h2>
    </div>
  )
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm text-textPrimary">
      {message}
    </p>
  )
}

export default function ClientConsultFlow({
  consultId,
  captureCopy,
}: {
  consultId: string
  captureCopy: BrandClientConsultCaptureCopy
}) {
  const router = useRouter()
  const base = `/api/v1/client/consult/${encodeURIComponent(consultId)}`

  const [status, setStatus] = useState<ConsultSessionDTO['status'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [agreements, setAgreements] = useState<ConsultAgreementStateDTO | null>(null)
  const [intake, setIntake] = useState<ConsultIntakeStateDTO | null>(null)
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({})
  const [inspiration, setInspiration] = useState<ConsultInspirationStateDTO | null>(null)
  const [capture, setCapture] = useState<ConsultCaptureStateDTO | null>(null)
  const [analysis, setAnalysis] = useState<ConsultAnalysisStateDTO | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const analysisKey = useRef<string>(newKey())
  // Local-only previews of this session's uploads (rejected photos are purged
  // server-side immediately, so the local blob is the only reviewable copy).
  const [slotPreviews, setSlotPreviews] = useState<Record<string, string>>({})
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({})
  const previewsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    previewsRef.current = slotPreviews
  }, [slotPreviews])
  useEffect(
    () => () => {
      for (const url of Object.values(previewsRef.current)) {
        URL.revokeObjectURL(url)
      }
    },
    [],
  )

  const refreshSession = useCallback(async () => {
    // Either anchor (booking or look) — only `status` is read here.
    const session = await api<{ consult: ConsultSessionLookupDTO }>(base)
    setStatus(session.consult.status)
    return session.consult.status
  }, [base])

  const loadStage = useCallback(
    async (stage: ConsultSessionDTO['status']) => {
      // CONSENT_REVOKED loads the agreements too: accepting one un-revokes the
      // session server-side, so this is the screen that leads back in. Without
      // it the revoked branch below renders its explanation next to no Accept
      // button, which looks like a dead end for a second time.
      if (stage === 'CONSENT_REQUIRED' || stage === 'CONSENT_REVOKED') {
        const state = await api<{ agreementState: ConsultAgreementStateDTO }>(
          `${base}/agreements`,
        )
        setAgreements(state.agreementState)
        return
      }
      if (stage === 'INTAKE_READY' || stage === 'INTAKE_IN_PROGRESS') {
        const state = await api<{ intake: ConsultIntakeStateDTO }>(`${base}/intake`)
        setIntake(state.intake)
        setIntakeAnswers(state.intake.latestRevision?.answers ?? {})
        return
      }
      if (stage === 'MEDIA_READY' || stage === 'ANALYSIS_PENDING') {
        const [inspirationState, captureState] = await Promise.all([
          api<{ inspiration: ConsultInspirationStateDTO }>(`${base}/inspiration`),
          api<{ capture: ConsultCaptureStateDTO }>(`${base}/capture`),
        ])
        setInspiration(inspirationState.inspiration)
        setCapture(captureState.capture)
        if (stage === 'ANALYSIS_PENDING') {
          const analysisState = await api<{ analysis: ConsultAnalysisStateDTO }>(
            `${base}/analysis`,
          )
          setAnalysis(analysisState.analysis)
        }
        return
      }
    },
    [base],
  )

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const stage = await refreshSession()
      if (stage === 'COMPLETED') {
        router.replace(`/client/consult/${encodeURIComponent(consultId)}/results`)
        return
      }
      await loadStage(stage)
    } catch (caught) {
      setError(
        caught instanceof ConsultFlowApiError
          ? caught.message
          : 'Something went wrong. Please try again.',
      )
    }
  }, [consultId, loadStage, refreshSession, router])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await work()
      } catch (caught) {
        setError(
          caught instanceof ConsultFlowApiError
            ? caught.message
            : 'Something went wrong. Please try again.',
        )
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  // ── Consent ───────────────────────────────────────────────────────────────
  const acceptAgreement = (kind: string, agreementVersionId: string) =>
    run(async () => {
      const state = await api<{ agreementState: ConsultAgreementStateDTO }>(
        `${base}/agreements/accept`,
        {
          method: 'POST',
          body: JSON.stringify({ kind, agreementVersionId }),
        },
      )
      setAgreements(state.agreementState)
      setStatus(state.agreementState.status)
      if (state.agreementState.status !== 'CONSENT_REQUIRED') {
        await loadStage(state.agreementState.status)
      }
    })

  // ── Intake ────────────────────────────────────────────────────────────────
  const submitIntake = (answers: Record<string, string>, complete: boolean) =>
    run(async () => {
      if (!intake) return
      const state = await api<{ intake: ConsultIntakeStateDTO }>(`${base}/intake`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          packVersion: intake.questionPack.version,
          schemaVersion: intake.questionPack.schemaVersion,
          complete,
          answers,
        }),
      })
      setIntake(state.intake)
      setIntakeAnswers(state.intake.latestRevision?.answers ?? answers)
      setStatus(state.intake.status)
      if (
        state.intake.status !== 'INTAKE_READY' &&
        state.intake.status !== 'INTAKE_IN_PROGRESS'
      ) {
        await loadStage(state.intake.status)
      }
    })

  // ── Inspiration ───────────────────────────────────────────────────────────
  const refreshInspiration = useCallback(async () => {
    const state = await api<{ inspiration: ConsultInspirationStateDTO }>(
      `${base}/inspiration`,
    )
    setInspiration(state.inspiration)
    return state.inspiration
  }, [base])

  const skipInspiration = () =>
    run(async () => {
      if (!inspiration) return
      const state = await api<{ inspiration: ConsultInspirationStateDTO }>(
        `${base}/inspiration`,
        {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: newKey(),
            source: 'NONE',
            schemaVersion: inspiration.schemaVersion,
          }),
        },
      )
      setInspiration(state.inspiration)
    })

  const uploadInspiration = (file: File) =>
    run(async () => {
      if (!inspiration) return
      const bytes = await file.arrayBuffer()
      const issued = await api<{
        upload: {
          inspirationId: string
          signedUrl: string | null
          maxBytes: number
        }
      }>(`${base}/inspiration/uploads`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          schemaVersion: inspiration.schemaVersion,
          contentType: file.type,
          sizeBytes: file.size,
          checksumSha256: await browserSha256Hex(bytes),
        }),
      })
      if (!issued.upload.signedUrl) {
        throw new ConsultFlowApiError('Upload is unavailable right now.', null)
      }
      const put = await fetch(issued.upload.signedUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type, 'x-upsert': 'false' },
        body: bytes,
      })
      if (!put.ok) {
        throw new ConsultFlowApiError('The photo upload failed. Try again.', null)
      }
      await api(`${base}/inspiration/attach`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          inspirationId: issued.upload.inspirationId,
          schemaVersion: inspiration.schemaVersion,
        }),
      })
      await refreshInspiration()
    })

  const answerInspiration = (
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
    text: string,
    sentiment: InspirationSentiment | null,
  ) =>
    run(async () => {
      if (!inspiration) return
      // The server requires exactly one of a free-text note (with a GOOD/BAD/
      // BOTH sentiment) or the "nothing-else" selection; a blank note means
      // "nothing else".
      const trimmed = question.allowText ? text.trim() : ''
      const values =
        question.allowText && !trimmed && selectedValues.length === 0
          ? ['nothing-else']
          : selectedValues
      await api(`${base}/inspiration/answers`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          schemaVersion: inspiration.schemaVersion,
          questionKey: question.key,
          selectedValues: values,
          ...(trimmed ? { text: trimmed, sentiment } : {}),
        }),
      })
      await refreshInspiration()
      await refresh()
    })

  // ── Capture ───────────────────────────────────────────────────────────────
  const refreshCapture = useCallback(async () => {
    const state = await api<{ capture: ConsultCaptureStateDTO }>(`${base}/capture`)
    setCapture(state.capture)
    return state.capture
  }, [base])

  const setSlotPreview = useCallback((shotKey: string, blob: Blob) => {
    setSlotPreviews((current) => {
      const previous = current[shotKey]
      if (previous) URL.revokeObjectURL(previous)
      return { ...current, [shotKey]: URL.createObjectURL(blob) }
    })
  }, [])

  const uploadShot = (shot: ConsultCaptureShotDTO, file: File) =>
    run(async () => {
      if (!capture) return
      setSlotErrors((current) => ({ ...current, [shot.key]: '' }))
      try {
        const prepared = await prepareImageForUpload(
          file,
          CONSULT_CAPTURE_MAX_BYTES,
        )
        const bytes = await prepared.arrayBuffer()
        const issued = await api<{
          upload: { uploadSessionId: string; signedUrl: string | null }
        }>(`${base}/capture/uploads`, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: newKey(),
            shotKey: shot.key,
            shotPackVersion: capture.shotPack.version,
            schemaVersion: capture.shotPack.schemaVersion,
            contentType: 'image/jpeg',
            sizeBytes: prepared.size,
            checksumSha256: await browserSha256Hex(bytes),
          }),
        })
        if (!issued.upload.signedUrl) {
          throw new ConsultFlowApiError('Upload is unavailable right now.', null)
        }
        const put = await fetch(issued.upload.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
          body: bytes,
        })
        if (!put.ok) {
          throw new ConsultFlowApiError('The photo upload failed. Try again.', null)
        }
        const attached = await api<{ captureId: string }>(`${base}/capture/attach`, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: newKey(),
            uploadSessionId: issued.upload.uploadSessionId,
            shotKey: shot.key,
            shotPackVersion: capture.shotPack.version,
            schemaVersion: capture.shotPack.schemaVersion,
          }),
        })
        // The photo is on the server now — keep the local copy reviewable even
        // if the quality verdict rejects (and purges) the server copy.
        setSlotPreview(shot.key, prepared)
        await api(
          `${base}/capture/${encodeURIComponent(attached.captureId)}/quality`,
          {
            method: 'POST',
            body: JSON.stringify({
              idempotencyKey: newKey(),
              shotPackVersion: capture.shotPack.version,
              schemaVersion: capture.shotPack.schemaVersion,
            }),
          },
        )
      } catch (caught) {
        // Bind the failure to the photo tile it belongs to instead of the
        // page-top banner the user scrolls away from.
        const message =
          caught instanceof ConsultFlowApiError ||
          caught instanceof ImagePreparationError
            ? caught.message
            : 'Something went wrong with this photo. Try again.'
        setSlotErrors((current) => ({ ...current, [shot.key]: message }))
      }
      await refreshCapture()
      await refresh()
    })

  const proceedWithAccepted = () =>
    run(async () => {
      const state = await api<{ capture: ConsultCaptureStateDTO }>(
        `${base}/capture/proceed`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      setCapture(state.capture)
      await refresh()
    })

  const setChartCopy = (optIn: boolean) =>
    run(async () => {
      const state = await api<{ capture: ConsultCaptureStateDTO }>(
        `${base}/capture/chart-copy`,
        { method: 'POST', body: JSON.stringify({ optIn }) },
      )
      setCapture(state.capture)
    })

  // ── Analysis ──────────────────────────────────────────────────────────────
  const startAnalysis = () =>
    run(async () => {
      if (!analysis) return
      setAnalyzing(true)
      try {
        const state = await api<{ analysis: ConsultAnalysisStateDTO }>(
          `${base}/analysis`,
          {
            method: 'POST',
            body: JSON.stringify({
              idempotencyKey: analysisKey.current,
              schemaVersion: analysis.schemaVersion,
              promptVersion: analysis.promptVersion,
            }),
          },
        )
        setAnalysis(state.analysis)
        if (state.analysis.status === 'COMPLETED') {
          router.replace(
            `/client/consult/${encodeURIComponent(consultId)}/results`,
          )
        }
      } finally {
        setAnalyzing(false)
      }
    })

  // ── Render ────────────────────────────────────────────────────────────────
  if (!status) {
    return (
      <div className="grid gap-4">
        <ErrorNote message={error} />
        <p className="text-sm text-textSecondary">Loading your consult…</p>
      </div>
    )
  }

  // CANCELLED is genuinely terminal — purged mid-analysis, with no transition
  // back. CONSENT_REVOKED is NOT: accepting a fresh agreement moves it back to
  // CONSENT_REQUIRED (lib/consult/writeBoundary.ts), so it falls through to the
  // consent step below. Collapsing the two here is what made revoking consent a
  // permanent dead end — the way back existed on the server and no screen ever
  // offered it.
  if (status === 'CANCELLED') {
    return (
      <div className={CARD}>
        <p className="text-sm text-textPrimary">
          This consult is no longer active.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <ErrorNote message={error} />

      {status === 'CONSENT_REVOKED' ? (
        <div className={CARD}>
          <p className="text-sm text-textPrimary">
            You revoked consent for this consult, so it stopped where it was.
            Accepting below starts it again.
          </p>
        </div>
      ) : null}

      {(status === 'CONSENT_REQUIRED' || status === 'CONSENT_REVOKED') &&
      agreements ? (
        <section className="grid gap-4">
          <StageHeading eyebrow="Step 1 of 4" title="Before we start" />
          {agreements.requirements.map((requirement) => {
            const accepted = Boolean(requirement.currentAcceptance)
            return (
              <div key={requirement.kind} className={CARD}>
                <h3 className="text-base font-black text-textPrimary">
                  {requirement.requiredVersion.title}
                </h3>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-textSecondary">
                  {requirement.requiredVersion.body}
                </p>
                <button
                  type="button"
                  className={`mt-4 ${accepted ? BUTTON_SECONDARY : BUTTON_PRIMARY}`}
                  disabled={busy || accepted}
                  onClick={() =>
                    acceptAgreement(
                      requirement.kind,
                      requirement.requiredVersion.id,
                    )
                  }
                >
                  {accepted ? 'Agreed' : 'I agree'}
                </button>
              </div>
            )
          })}
        </section>
      ) : null}

      {(status === 'INTAKE_READY' || status === 'INTAKE_IN_PROGRESS') && intake ? (
        <IntakeStage
          intake={intake}
          answers={intakeAnswers}
          busy={busy}
          onAnswer={(questionKey, value) => {
            const next = { ...intakeAnswers, [questionKey]: value }
            setIntakeAnswers(next)
            void submitIntake(next, false)
          }}
          onComplete={() => void submitIntake(intakeAnswers, true)}
        />
      ) : null}

      {(status === 'MEDIA_READY' || status === 'ANALYSIS_PENDING') &&
      inspiration ? (
        <InspirationStage
          inspiration={inspiration}
          busy={busy}
          onSkip={() => void skipInspiration()}
          onUpload={(file) => void uploadInspiration(file)}
          onAnswer={(question, values, text, sentiment) =>
            void answerInspiration(question, values, text, sentiment)
          }
        />
      ) : null}

      {(status === 'MEDIA_READY' || status === 'ANALYSIS_PENDING') && capture ? (
        <CaptureStage
          capture={capture}
          copy={captureCopy}
          busy={busy}
          slotPreviews={slotPreviews}
          slotErrors={slotErrors}
          inspirationDone={Boolean(
            inspiration &&
              inspiration.progress.canComplete &&
              !inspiration.progress.currentQuestion,
          )}
          onUpload={(shot, file) => void uploadShot(shot, file)}
          onChartCopy={(optIn) => void setChartCopy(optIn)}
          onProceed={() => void proceedWithAccepted()}
        />
      ) : null}

      {status === 'ANALYSIS_PENDING' && analysis ? (
        <section className={CARD}>
          <StageHeading eyebrow="Final step" title="Run your analysis" />
          <p className="mt-2 text-sm leading-6 text-textSecondary">
            Your photos and answers are ready. The analysis takes a minute or
            two, and your photos are deleted from processing storage right
            after it finishes.
          </p>
          <button
            type="button"
            className={`mt-4 ${BUTTON_PRIMARY}`}
            disabled={busy || analyzing}
            onClick={() => void startAnalysis()}
          >
            {analyzing ? 'Analyzing — hold tight…' : 'Run my analysis'}
          </button>
        </section>
      ) : null}

      {status === 'ANALYZING' ? (
        <section className={CARD}>
          <p className="text-sm text-textPrimary">
            Your analysis is running. This can take a minute or two.
          </p>
          <button
            type="button"
            className={`mt-4 ${BUTTON_SECONDARY}`}
            onClick={() => void refresh()}
          >
            Check progress
          </button>
        </section>
      ) : null}
    </div>
  )
}

function IntakeStage({
  intake,
  answers,
  busy,
  onAnswer,
  onComplete,
}: {
  intake: ConsultIntakeStateDTO
  answers: Record<string, string>
  busy: boolean
  onAnswer: (questionKey: string, value: string) => void
  onComplete: () => void
}) {
  const nextKey = intake.progress.nextQuestionKey
  const question = useMemo(() => {
    if (nextKey) {
      return intake.questionPack.questions.find((entry) => entry.key === nextKey)
    }
    return intake.questionPack.questions.find((entry) => !answers[entry.key])
  }, [answers, intake.questionPack.questions, nextKey])
  const answeredCount = intake.questionPack.questions.filter(
    (entry) => answers[entry.key],
  ).length

  return (
    <section className="grid gap-4">
      <StageHeading eyebrow="Step 2 of 4" title="Tell us about your goal" />
      <div className={CARD}>
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted">
          {answeredCount} / {intake.questionPack.questions.length} answered
        </div>
        {question ? (
          <div className="mt-3 grid gap-3">
            <h3 className="text-base font-black text-textPrimary">
              {question.label}
            </h3>
            {question.helpText ? (
              <p className="text-sm text-textSecondary">{question.helpText}</p>
            ) : null}
            <div className="grid gap-2">
              {question.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  className={`${
                    answers[question.key] === option.value
                      ? BUTTON_PRIMARY
                      : BUTTON_SECONDARY
                  } text-left`}
                  onClick={() => onAnswer(question.key, option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {question.requirement === 'SKIPPABLE' && !answers[question.key] ? (
              <button
                type="button"
                disabled={busy}
                className={`${BUTTON_SECONDARY} justify-self-start`}
                onClick={() => onAnswer(question.key, question.options[0]!.value)}
              >
                Use “{question.options[0]!.label}”
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            <p className="text-sm text-textPrimary">
              That is everything we need for this part.
            </p>
            <button
              type="button"
              disabled={busy || !intake.progress.canComplete}
              className={`${BUTTON_PRIMARY} justify-self-start`}
              onClick={onComplete}
            >
              Continue to photos
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Pinch/wheel/double-tap zoomable image so the client can inspect the exact
 * area a question asks about. Pointer events cover mouse and touch; two-finger
 * pinch is handled by tracking both active pointers.
 */
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null)

  const clamp = (next: { scale: number; x: number; y: number }) => {
    const scale = Math.min(4, Math.max(1, next.scale))
    const range = 160 * (scale - 1)
    return {
      scale,
      x: Math.min(range, Math.max(-range, next.x)),
      y: Math.min(range, Math.max(-range, next.y)),
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-surfaceGlass/10">
      <div
        className="touch-none select-none"
        onDoubleClick={() =>
          setTransform((current) =>
            current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.2, x: 0, y: 0 },
          )
        }
        onWheel={(event) => {
          setTransform((current) =>
            clamp({
              ...current,
              scale: current.scale * (event.deltaY < 0 ? 1.15 : 0.87),
            }),
          )
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          })
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId)
          if (!previous) return
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          })
          const points = [...pointers.current.values()]
          if (points.length >= 2) {
            const [a, b] = points as [
              { x: number; y: number },
              { x: number; y: number },
            ]
            const distance = Math.hypot(a.x - b.x, a.y - b.y)
            if (!pinchStart.current) {
              pinchStart.current = { distance, scale: transform.scale }
              return
            }
            const start = pinchStart.current
            setTransform((current) =>
              clamp({
                ...current,
                scale: start.scale * (distance / start.distance),
              }),
            )
            return
          }
          setTransform((current) =>
            current.scale <= 1
              ? current
              : clamp({
                  ...current,
                  x: current.x + (event.clientX - previous.x),
                  y: current.y + (event.clientY - previous.y),
                }),
          )
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId)
          if (pointers.current.size < 2) pinchStart.current = null
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId)
          if (pointers.current.size < 2) pinchStart.current = null
        }}
      >
        <RemoteImage
          src={src}
          alt={alt}
          intrinsic
          draggable={false}
          className="max-h-80 w-full object-contain"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
          }}
        />
      </div>
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          type="button"
          aria-label="Zoom out"
          className={CHIP_INACTIVE + ' bg-bgSurface'}
          onClick={() =>
            setTransform((current) => clamp({ ...current, scale: current.scale * 0.8 }))
          }
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          className={CHIP_INACTIVE + ' bg-bgSurface'}
          onClick={() =>
            setTransform((current) => clamp({ ...current, scale: current.scale * 1.25 }))
          }
        >
          +
        </button>
        {transform.scale > 1 ? (
          <button
            type="button"
            className={CHIP_INACTIVE + ' bg-bgSurface'}
            onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The signed-read response, validated rather than trusted.
 *
 * 🔴 The read endpoint is server-supplied, so its answer is a claim, not a
 * fact. The previous version destructured it straight into state: a route that
 * answered some OTHER shape (which is exactly what look-anchored consults got
 * — `/api/v1/looks/{id}`) produced `url: undefined` and
 * `expiresAt: NaN`, which rendered a broken image AND scheduled the next
 * refresh from `NaN`. `setTimeout(fn, NaN)` fires on the next tick, so the
 * panel refetched the same endpoint forever. Fail CLOSED: an answer that is
 * not `{ url: string, expiresInSeconds: finite > 0 }` is an error, not a URL.
 */
function parseSignedRead(
  value: unknown,
): { url: string; expiresInSeconds: number } | null {
  if (!value || typeof value !== 'object') return null
  const { url, expiresInSeconds } = value as {
    url?: unknown
    expiresInSeconds?: unknown
  }
  if (typeof url !== 'string' || url.length === 0) return null
  if (typeof expiresInSeconds !== 'number') return null
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return null
  return { url, expiresInSeconds }
}

/** Telemetry for a read the client could not use. Mirrors iOS's os_log line. */
function reportInspirationReadFailure(
  endpoint: string,
  reason: 'CONTRACT_MISMATCH' | 'REQUEST_FAILED',
  detail: string | null,
): void {
  Sentry.captureMessage('consult.inspiration.image_read_failed', {
    level: 'warning',
    tags: {
      namespace: 'ai_consult',
      metric: 'INSPIRATION_IMAGE_READ_FAILED',
      reason,
    },
    // The endpoint is a route template plus this consult's own id — no media
    // path, no signed token, no client trait. Matches the privacy boundary
    // lib/observability/aiConsultEvents.ts draws for the server-side lines.
    extra: { endpoint, detail },
  })
}

/**
 * Keeps the inspiration photo — uploaded OR the anchoring Look — on screen
 * through the whole question flow. One endpoint answers both
 * (`imageReadEndpoint`, see `ConsultInspirationSourceStateDTO`).
 *
 * Refresh scheduling is derived ONLY from a validated `expiresInSeconds`. When
 * the read fails or answers the wrong shape, the panel surfaces the failure
 * with a manual retry and schedules nothing — there is no timer that can turn
 * a broken contract into a request loop.
 */
function InspirationImagePanel({
  source,
  focusHint,
}: {
  source: NonNullable<ConsultInspirationStateDTO['source']>
  focusHint: string | null
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // The ONLY thing that starts a read. It advances on mount, on an endpoint
  // change, and from exactly two places: the renewal timer a SUCCESSFUL read
  // scheduled, and the user's Retry press. A failure advances nothing, so a
  // persistently broken read costs one request, not a loop.
  const [attempt, setAttempt] = useState(0)
  const endpoint = source.imageReadEndpoint

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    void (async () => {
      let read: { url: string; expiresInSeconds: number } | null = null
      try {
        read = parseSignedRead(await api<unknown>(endpoint))
        if (!read) reportInspirationReadFailure(endpoint, 'CONTRACT_MISMATCH', null)
      } catch (error) {
        reportInspirationReadFailure(
          endpoint,
          'REQUEST_FAILED',
          error instanceof ConsultFlowApiError ? error.code : null,
        )
      }
      if (cancelled) return
      if (!read) {
        setSignedUrl(null)
        setFailed(true)
        return
      }
      setSignedUrl(read.url)
      setFailed(false)
      // Renew shortly before the URL dies so the photo never goes dark
      // mid-questionnaire. The delay is finite by construction (only a
      // validated, positive, finite `expiresInSeconds` reaches this line) and
      // floored at 30s so a server that ever answers a very short TTL slows
      // the panel down rather than turning it back into a request loop.
      timer = setTimeout(
        () => setAttempt((value) => value + 1),
        Math.max(30_000, read.expiresInSeconds * 1000 - 60_000),
      )
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [endpoint, attempt])

  if (!source.imageAvailable) return null
  return (
    <div className="mt-4 grid gap-2">
      {signedUrl ? (
        <ZoomableImage src={signedUrl} alt="Your inspiration photo" />
      ) : failed ? (
        <div
          role="alert"
          data-testid="inspiration-image-error"
          className="grid gap-2 rounded-lg border border-toneDanger/30 bg-toneDanger/10 px-3 py-3"
        >
          <p className="text-sm font-bold text-textPrimary">
            We couldn’t load your inspiration photo.
          </p>
          <p className="text-xs leading-5 text-textSecondary">
            Answer these questions with the photo in front of you — tap retry,
            and if it still won’t load, go back a step and pick it again.
          </p>
          <div>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              onClick={() => {
                // Clearing `failed` swaps the alert for the loading line, so
                // the press has visible feedback without a second flag.
                setFailed(false)
                setAttempt((value) => value + 1)
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-textSecondary">
          Loading your inspiration photo…
        </p>
      )}
      {focusHint ? (
        <p className="rounded-lg border border-surfaceGlass/10 bg-surfaceGlass/10 px-3 py-2 text-xs leading-5 text-textPrimary">
          {focusHint} Pinch, scroll, or double-tap the photo to zoom.
        </p>
      ) : null}
    </div>
  )
}

function InspirationStage({
  inspiration,
  busy,
  onSkip,
  onUpload,
  onAnswer,
}: {
  inspiration: ConsultInspirationStateDTO
  busy: boolean
  onSkip: () => void
  onUpload: (file: File) => void
  onAnswer: (
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
    text: string,
    sentiment: InspirationSentiment | null,
  ) => void
}) {
  const question = inspiration.progress.currentQuestion

  if (inspiration.progress.canComplete && !question) return null

  return (
    <section className="grid gap-4">
      <StageHeading eyebrow="Step 3 of 4" title="Your inspiration" />
      <div className={CARD}>
        <p className="text-sm leading-6 text-textSecondary">
          {inspiration.introduction}
        </p>
        {inspiration.progress.blocker === 'SOURCE_DECISION_REQUIRED' ? (
          <div className="mt-4 grid gap-2">
            <label className={`${BUTTON_PRIMARY} cursor-pointer text-center`}>
              Add an inspiration photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onUpload(file)
                  event.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className={BUTTON_SECONDARY}
              onClick={onSkip}
            >
              Continue without one
            </button>
          </div>
        ) : null}
        {inspiration.source && question ? (
          <InspirationImagePanel
            source={inspiration.source}
            focusHint={INSPIRATION_FOCUS[question.key] ?? null}
          />
        ) : null}
        {inspiration.source && question ? (
          <p className="mt-2 text-xs leading-5 text-textMuted">
            {inspiration.referenceNote}
          </p>
        ) : null}
        {inspiration.progress.blocker === 'AT_LEAST_THREE_DETAILS_REQUIRED' ? (
          <p className="mt-3 rounded-lg border border-toneInfo/30 bg-toneInfo/10 px-3 py-2 text-xs leading-5 text-textPrimary">
            Pick out at least three specific details you love or want to avoid
            across these questions — answers like “not sure” don’t give your
            professional anything to work from, so a couple of questions are
            coming back around.
          </p>
        ) : null}
        {question ? (
          <InspirationQuestionForm
            key={question.key}
            question={question}
            busy={busy}
            onAnswer={onAnswer}
          />
        ) : null}
      </div>
    </section>
  )
}

function InspirationQuestionForm({
  question,
  busy,
  onAnswer,
}: {
  question: ConsultInspirationQuestionDTO
  busy: boolean
  onAnswer: (
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
    text: string,
    sentiment: InspirationSentiment | null,
  ) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [sentiment, setSentiment] = useState<InspirationSentiment | null>(null)

  const trimmed = question.allowText ? text.trim() : ''
  const traitBlocked = Boolean(
    trimmed && CONSULT_INSPIRATION_UNSUPPORTED_TRAIT_LANGUAGE.test(trimmed),
  )
  const needsSentiment = Boolean(trimmed) && !sentiment
  const needsSelection =
    question.kind !== 'TEXT' && selected.length < question.minSelections

  const toggleOption = (value: string) => {
    setSelected((current) => {
      if (question.kind === 'SINGLE_SELECT') return [value]
      if (current.includes(value)) {
        return current.filter((entry) => entry !== value)
      }
      // The server refuses a neutral choice ("None", "Not sure", "Nothing
      // else") combined with anything else — keep the selection consistent
      // instead of letting the mix bounce with a generic error.
      if (NEUTRAL_INSPIRATION_VALUES.has(value)) return [value]
      const withoutNeutrals = current.filter(
        (entry) => !NEUTRAL_INSPIRATION_VALUES.has(entry),
      )
      if (withoutNeutrals.length >= question.maxSelections) return current
      return [...withoutNeutrals, value]
    })
    if (question.kind === 'TEXT') {
      // "Nothing else" and a written note are mutually exclusive.
      setText('')
      setSentiment(null)
    }
  }

  return (
    <div className="mt-4 grid gap-3">
      <h3 className="text-base font-black text-textPrimary">{question.label}</h3>
      {question.helpText ? (
        <p className="text-sm text-textSecondary">{question.helpText}</p>
      ) : null}
      <div className="grid gap-2">
        {question.options.map((option) => {
          const active = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              disabled={busy}
              className={`${active ? BUTTON_PRIMARY : BUTTON_SECONDARY} text-left`}
              onClick={() => toggleOption(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {question.allowText || question.kind === 'TEXT' ? (
        <div className="grid gap-2">
          <textarea
            className="rounded-xl border border-surfaceGlass/20 bg-bgPrimary p-3 text-sm text-textPrimary"
            rows={2}
            maxLength={CONSULT_INSPIRATION_TEXT_MAX_CHARS}
            value={text}
            placeholder="Anything else, in your own words — or leave this blank"
            onChange={(event) => {
              setText(event.target.value)
              if (event.target.value.trim()) {
                setSelected((current) =>
                  current.filter((entry) => entry !== 'nothing-else'),
                )
              }
            }}
          />
          {trimmed ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-textSecondary">This is…</span>
              {SENTIMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  className={
                    sentiment === option.value ? CHIP_ACTIVE : CHIP_INACTIVE
                  }
                  onClick={() => setSentiment(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {traitBlocked ? (
            <p className="rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-3 py-2 text-xs leading-5 text-textPrimary">
              Keep this note about the look itself — words about the face,
              eyes, skin, or body can’t be included here. Your photos already
              show your professional everything they need.
            </p>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        disabled={busy || needsSelection || needsSentiment || traitBlocked}
        className={`${BUTTON_PRIMARY} justify-self-start`}
        onClick={() => onAnswer(question, selected, text, sentiment)}
      >
        Next
      </button>
      {needsSentiment ? (
        <p className="text-xs text-textMuted">
          Tell us whether that note is something you like, something to avoid,
          or a bit of both.
        </p>
      ) : null}
    </div>
  )
}

function slotLabel(slot: ConsultCaptureSlotStateDTO | undefined): string {
  if (!slot || slot.state === 'EMPTY') return 'Add photo'
  if (slot.state === 'ACCEPTED') return 'Accepted ✓'
  if (slot.state === 'REJECTED') return 'Retake photo'
  if (slot.state === 'EXPIRED' || slot.state === 'PURGED') return 'Add photo again'
  return 'Checking…'
}

function CaptureStage({
  capture,
  copy,
  busy,
  slotPreviews,
  slotErrors,
  inspirationDone,
  onUpload,
  onChartCopy,
  onProceed,
}: {
  capture: ConsultCaptureStateDTO
  copy: BrandClientConsultCaptureCopy
  busy: boolean
  slotPreviews: Record<string, string>
  slotErrors: Record<string, string>
  inspirationDone: boolean
  onUpload: (shot: ConsultCaptureShotDTO, file: File) => void
  onChartCopy: (optIn: boolean) => void
  onProceed: () => void
}) {
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(
    null,
  )
  const slots = new Map(capture.slots.map((slot) => [slot.shotKey, slot]))
  const totalCount = capture.shotPack.shots.length
  const acceptedCount = capture.slots.filter(
    (slot) => slot.state === 'ACCEPTED',
  ).length
  const rejectedCount = capture.slots.filter(
    (slot) => slot.state === 'REJECTED',
  ).length
  const showPartialContinue =
    capture.status === 'MEDIA_READY' &&
    acceptedCount >= 1 &&
    acceptedCount < totalCount

  return (
    <section className="grid gap-4">
      <StageHeading eyebrow={copy.eyebrow} title={copy.title} />
      <p className="text-sm leading-6 text-textSecondary">
        {formatConsultCaptureIntro(copy, capture.shotPack)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {capture.shotPack.shots.map((shot) => {
          const slot = slots.get(shot.key)
          const accepted = slot?.state === 'ACCEPTED'
          const preview = slotPreviews[shot.key]
          const slotError = slotErrors[shot.key]
          return (
            <div key={shot.key} className={CARD}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black text-textPrimary">
                    {shot.title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-textSecondary">
                    {shot.instruction}
                  </p>
                </div>
                {preview ? (
                  <button
                    type="button"
                    className="shrink-0 overflow-hidden rounded-lg border border-surfaceGlass/20"
                    aria-label={`View your ${shot.title} photo`}
                    onClick={() => setLightbox({ url: preview, title: shot.title })}
                  >
                    <RemoteImage
                      src={preview}
                      alt={`Your ${shot.title} photo`}
                      intrinsic
                      className="h-16 w-16 object-cover"
                    />
                  </button>
                ) : null}
              </div>
              {slot?.state === 'REJECTED' ? (
                <div className="mt-2 rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-2 py-1.5 text-xs leading-5 text-textPrimary">
                  {slot.qualityReasonCode
                    ? QUALITY_REASON_COPY[slot.qualityReasonCode]
                    : QUALITY_REASON_COPY.OTHER_QUALITY_FAILURE}
                  {slot.retakeTip ? ` ${slot.retakeTip}` : null}
                </div>
              ) : null}
              {slotError ? (
                <p className="mt-2 rounded-lg border border-toneDanger/30 bg-toneDanger/10 px-2 py-1.5 text-xs leading-5 text-textPrimary">
                  {slotError}
                </p>
              ) : null}
              <label
                className={`mt-3 inline-block cursor-pointer ${
                  accepted ? BUTTON_SECONDARY : BUTTON_PRIMARY
                }`}
              >
                {slotLabel(slot)}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={busy || accepted}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onUpload(shot, file)
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
          )
        })}
      </div>
      <div className={CARD}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={capture.chartCopy.optIn}
            disabled={busy}
            onChange={(event) => onChartCopy(event.target.checked)}
          />
          <span className="text-sm leading-6 text-textPrimary">
            Keep these photos on my chart with my professional, so future
            appointments can refer back to them. You can turn this off any time
            before the analysis runs; otherwise photos are deleted after
            analysis either way.
          </span>
        </label>
      </div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted">
        {acceptedCount} / {totalCount} photos accepted
        {rejectedCount > 0 ? ` · ${rejectedCount} need a retake` : ''}
      </div>
      {showPartialContinue ? (
        <div className={CARD}>
          <p className="text-sm leading-6 text-textSecondary">
            You can keep going with the photos that were accepted. The views
            you skip can’t be analyzed, so those parts of your results will
            honestly say unknown.
          </p>
          <button
            type="button"
            className={`mt-3 ${BUTTON_SECONDARY}`}
            disabled={busy || !inspirationDone}
            onClick={onProceed}
          >
            Continue with {acceptedCount} of {totalCount} photos
          </button>
          {!inspirationDone ? (
            <p className="mt-2 text-xs text-textMuted">
              Finish the inspiration step above first.
            </p>
          ) : null}
        </div>
      ) : null}
      {lightbox ? (
        <button
          type="button"
          aria-label="Close photo preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <span className="grid max-h-full gap-2">
            <RemoteImage
              src={lightbox.url}
              alt={`Your ${lightbox.title} photo`}
              intrinsic
              className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain"
            />
            <span className="justify-self-center rounded-lg bg-bgSurface px-3 py-1 text-center text-xs font-bold text-textPrimary">
              {lightbox.title} — tap anywhere to close
            </span>
          </span>
        </button>
      ) : null}
    </section>
  )
}
