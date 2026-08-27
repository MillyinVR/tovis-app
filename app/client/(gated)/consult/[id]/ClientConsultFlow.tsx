'use client'

// Web client consult wizard (2026-08-26 full-analysis launch). Drives the
// existing consult API contracts end to end: consent → intake (one question at
// a time) → inspiration → seven-shot capture with the chart-copy choice →
// analysis → results. All legal wording, questions, and shot instructions are
// server-served; this component only renders them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  ConsultAgreementStateDTO,
  ConsultAnalysisStateDTO,
  ConsultCaptureShotDTO,
  ConsultCaptureSlotStateDTO,
  ConsultCaptureStateDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationStateDTO,
  ConsultIntakeStateDTO,
  ConsultSessionDTO,
} from '@/lib/dto/consult'

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

export default function ClientConsultFlow({ consultId }: { consultId: string }) {
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

  const refreshSession = useCallback(async () => {
    const session = await api<{ consult: ConsultSessionDTO }>(base)
    setStatus(session.consult.status)
    return session.consult.status
  }, [base])

  const loadStage = useCallback(
    async (stage: ConsultSessionDTO['status']) => {
      if (stage === 'CONSENT_REQUIRED') {
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
  ) =>
    run(async () => {
      if (!inspiration) return
      await api(`${base}/inspiration/answers`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          schemaVersion: inspiration.schemaVersion,
          questionKey: question.key,
          selectedValues,
          ...(question.allowText && text.trim() ? { text: text.trim() } : {}),
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

  const uploadShot = (shot: ConsultCaptureShotDTO, file: File) =>
    run(async () => {
      if (!capture) return
      const bytes = await file.arrayBuffer()
      const issued = await api<{
        upload: { uploadSessionId: string; signedUrl: string | null }
      }>(`${base}/capture/uploads`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          shotKey: shot.key,
          shotPackVersion: capture.shotPack.version,
          schemaVersion: capture.shotPack.schemaVersion,
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
      await refreshCapture()
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

  if (status === 'CANCELLED' || status === 'CONSENT_REVOKED') {
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

      {status === 'CONSENT_REQUIRED' && agreements ? (
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
          onAnswer={(question, values, text) =>
            void answerInspiration(question, values, text)
          }
        />
      ) : null}

      {(status === 'MEDIA_READY' || status === 'ANALYSIS_PENDING') && capture ? (
        <CaptureStage
          capture={capture}
          busy={busy}
          onUpload={(shot, file) => void uploadShot(shot, file)}
          onChartCopy={(optIn) => void setChartCopy(optIn)}
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
  ) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')

  return (
    <div className="mt-4 grid gap-3">
      <h3 className="text-base font-black text-textPrimary">{question.label}</h3>
      {question.helpText ? (
        <p className="text-sm text-textSecondary">{question.helpText}</p>
      ) : null}
      {question.kind === 'TEXT' ? null : (
        <div className="grid gap-2">
          {question.options.map((option) => {
            const active = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                disabled={busy}
                className={`${active ? BUTTON_PRIMARY : BUTTON_SECONDARY} text-left`}
                onClick={() =>
                  setSelected((current) =>
                    question.kind === 'SINGLE_SELECT'
                      ? [option.value]
                      : active
                        ? current.filter((value) => value !== option.value)
                        : current.length < question.maxSelections
                          ? [...current, option.value]
                          : current,
                  )
                }
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
      {question.allowText || question.kind === 'TEXT' ? (
        <textarea
          className="rounded-xl border border-surfaceGlass/20 bg-bgPrimary p-3 text-sm text-textPrimary"
          rows={2}
          maxLength={280}
          value={text}
          placeholder="Anything else, in your own words (optional)"
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        disabled={busy || selected.length < question.minSelections}
        className={`${BUTTON_PRIMARY} justify-self-start`}
        onClick={() => onAnswer(question, selected, text)}
      >
        Next
      </button>
    </div>
  )
}

function slotLabel(slot: ConsultCaptureSlotStateDTO | undefined): string {
  if (!slot || slot.state === 'EMPTY') return 'Add photo'
  if (slot.state === 'ACCEPTED') return 'Accepted ✓'
  if (slot.state === 'REJECTED') return 'Retake needed'
  if (slot.state === 'EXPIRED' || slot.state === 'PURGED') return 'Add photo again'
  return 'Checking…'
}

function CaptureStage({
  capture,
  busy,
  onUpload,
  onChartCopy,
}: {
  capture: ConsultCaptureStateDTO
  busy: boolean
  onUpload: (shot: ConsultCaptureShotDTO, file: File) => void
  onChartCopy: (optIn: boolean) => void
}) {
  const slots = new Map(capture.slots.map((slot) => [slot.shotKey, slot]))
  const acceptedCount = capture.slots.filter(
    (slot) => slot.state === 'ACCEPTED',
  ).length

  return (
    <section className="grid gap-4">
      <StageHeading eyebrow="Step 4 of 4" title="Your photos" />
      <p className="text-sm leading-6 text-textSecondary">
        Seven daylight photos: four of your hair and three of your face. Each
        one is checked right away, with a tip if a retake would help.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {capture.shotPack.shots.map((shot) => {
          const slot = slots.get(shot.key)
          const accepted = slot?.state === 'ACCEPTED'
          return (
            <div key={shot.key} className={CARD}>
              <h3 className="text-sm font-black text-textPrimary">{shot.title}</h3>
              <p className="mt-1 text-xs leading-5 text-textSecondary">
                {shot.instruction}
              </p>
              {slot?.state === 'REJECTED' && slot.retakeTip ? (
                <p className="mt-2 rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-2 py-1.5 text-xs text-textPrimary">
                  {slot.retakeTip}
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
                  capture="environment"
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
        {acceptedCount} / {capture.shotPack.shots.length} photos accepted
      </div>
    </section>
  )
}
