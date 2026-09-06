'use client'

// The client consult, as a THREAD (P5a — "the consult is a chat", handoff
// Part 2). It replaces the four-step wizard this file used to be.
//
// What changed, and why it is not a re-skin:
//
//   * ONE read drives the screen. `GET …/consult/[id]/thread` serves the whole
//     flow state as an ordered message list plus `nextOpenMessageId`, so
//     "reopening resumes at the next open step" is the server's answer, not
//     four progress blockers re-interpreted here. The per-stage endpoints are
//     unchanged and remain the only way to ANSWER anything.
//   * Earlier steps stay on screen as history. A wizard that replaces the
//     question you just answered gives you nothing to scroll back to.
//   * No free-text input, anywhere. Every prompt is a tappable card, which is
//     what makes the thread deterministic, instant and free per message.
//   * The sticky Book the look CTA unlocks on the SELFIE, not on the analysis.
//     Booking runs the ORDINARY look-booking path — the analysis takes ~100s,
//     which is longer than a spark lasts.
//
// All legal wording, questions, shot instructions and system-bubble copy are
// server-served; this component renders them and owns the mutations.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useRouter } from 'next/navigation'

import type { BrandClientConsultThreadCopy } from '@/lib/brand/types'
import { fillConsultThreadCopy } from '@/lib/consult/threadCopy'
import { CONSULT_EARLY_PHOTO_SHOT_KEY } from '@/lib/consult/capture/earlyPhoto'
import { CONSULT_CAPTURE_MAX_BYTES } from '@/lib/consult/capturePack'
import {
  CONSULT_ANALYSIS_POLL_INTERVAL_MS,
  consultAnalysisRunProgress,
  isConsultAnalysisRunLive,
} from '@/lib/consult/analysisRunCopy'
import type {
  ConsultAnalysisRunDTO,
  ConsultCaptureQualityReasonCodeDTO,
  ConsultCaptureSlotStateDTO,
  ConsultInspirationCardDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationStateDTO,
  ConsultIntakeSubmitResponseDTO,
  ConsultThreadConsentMessageDTO,
  ConsultThreadDTO,
  ConsultThreadInspirationMessageDTO,
  ConsultThreadMessageDTO,
  ConsultThreadPhotoRequestMessageDTO,
  ConsultThreadPlanMessageDTO,
  ConsultThreadPlanUpdateMessageDTO,
  ConsultThreadQuestionMessageDTO,
} from '@/lib/dto/consult'
import RemoteImage from '@/app/_components/media/RemoteImage'
import {
  ImagePreparationError,
  prepareImageForUpload,
} from '@/lib/media/prepareImageForUpload'

import {
  THREAD_BUTTON_PRIMARY,
  THREAD_BUTTON_SECONDARY,
  ThreadBubble,
  ThreadCard,
  ThreadMessageSlot,
  ThreadShell,
} from './_thread/ThreadShell'

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

const BUTTON_PRIMARY = THREAD_BUTTON_PRIMARY
const BUTTON_SECONDARY = THREAD_BUTTON_SECONDARY
/** The small square controls on the zoomable inspiration image. */
const CHIP_INACTIVE =
  'rounded-lg border border-surfaceGlass/20 px-3 py-1.5 text-xs font-bold text-textPrimary disabled:opacity-50'

/**
 * Values the server refuses to combine with anything else ("None", "Not sure",
 * "Nothing else"). Picking one clears the rest instead of letting the mix
 * bounce back as a generic error.
 */
const NEUTRAL_INSPIRATION_VALUES = new Set([
  'none',
  'not-sure',
  'nothing-else',
])

/**
 * 🔴 P5d DELETED the per-question focus hint map that used to live here (and
 * its iOS twin, `consultInspirationFocusHints`).
 *
 * It was a sentence telling the client where to LOOK — "zoom into the hair and
 * look at the mix of colors" — written once per question key and guessed at
 * per pack. A card does not need one: it shows her the crop.
 *
 * Do not reintroduce it. A hint that describes a region the server can send is
 * a second, hand-maintained answer to a question the reading already answers,
 * and it drifts silently the moment a pack asks something it was never taught.
 */

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

/**
 * P4b: the waiting screen for a background analysis run.
 *
 * Three states, and the difference between them matters more than the styling:
 * a LIVE run shows progress and no buttons (there is nothing useful to press);
 * a FAILED run shows the retry, which is the whole reason a client is not
 * stranded; a COMPLETED run is a moment the poll is about to route away from,
 * so it just says so rather than flashing a control.
 *
 * The bar is `aria-hidden` and the same information is in the text above it —
 * a progress bar with no accessible name is decoration, and the headline is
 * the real status.
 */
function AnalysisRunProgress({
  run,
  busy,
  onRetry,
  onRefresh,
}: {
  run: ConsultAnalysisRunDTO
  busy: boolean
  onRetry: () => void
  onRefresh: () => void
}) {
  const progress = consultAnalysisRunProgress(run)
  const live = isConsultAnalysisRunLive(run)

  return (
    <div>
      <StageHeading eyebrow="Analysis" title="We’re building your plan" />
      <p
        className="mt-3 text-sm font-bold text-textPrimary"
        role="status"
        aria-live="polite"
      >
        {progress.headline}
      </p>
      {progress.detail ? (
        <p className="mt-1 text-sm leading-6 text-textSecondary">
          {progress.detail}
        </p>
      ) : null}

      <div
        aria-hidden="true"
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surfaceGlass/10"
      >
        <div
          className="h-full rounded-full bg-textPrimary transition-[width] duration-700 ease-out"
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>

      {run.status === 'FAILED' ? (
        <button
          type="button"
          className={`mt-4 ${BUTTON_PRIMARY}`}
          disabled={busy}
          onClick={onRetry}
        >
          {busy ? 'Starting…' : 'Try again'}
        </button>
      ) : null}

      {live ? (
        <p className="mt-4 text-xs leading-5 text-textSecondary">
          You can close this — we’ll let you know when it’s ready.
        </p>
      ) : null}

      {!live && run.status !== 'FAILED' ? (
        <button
          type="button"
          className={`mt-4 ${BUTTON_SECONDARY}`}
          onClick={onRefresh}
        >
          Check progress
        </button>
      ) : null}
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
  copy,
}: {
  consultId: string
  /** Every system bubble's wording, from the brand copy table. */
  copy: BrandClientConsultThreadCopy
}) {
  const router = useRouter()
  const base = `/api/v1/client/consult/${encodeURIComponent(consultId)}`

  const [thread, setThread] = useState<ConsultThreadDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const analysisKey = useRef<string>(newKey())
  // P5b — the inspiration read stage: its own busy flag, its own error, and
  // the id of the reference it last asked about.
  const [inspirationFullscreen, setInspirationFullscreen] = useState(false)
  const [readingInspiration, setReadingInspiration] = useState(false)
  const [inspirationReadError, setInspirationReadError] = useState<string | null>(
    null,
  )
  const inspirationRead = useRef<string | null>(null)

  // Local-only previews of this session's uploads. A REJECTED photo is purged
  // server-side immediately, so this blob is the only copy she can still look
  // at while reading why it was refused.
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

  /** The one read. Everything on screen comes from it. */
  const refresh = useCallback(async () => {
    const next = await api<{ thread: ConsultThreadDTO }>(`${base}/thread`)
    setThread(next.thread)
    return next.thread
  }, [base])

  const load = useCallback(async () => {
    setError(null)
    try {
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof ConsultFlowApiError
          ? caught.message
          : 'Something went wrong. Please try again.',
      )
    }
  }, [refresh])

  useEffect(() => {
    void load()
  }, [load])

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await work()
        await refresh()
      } catch (caught) {
        setError(
          // ImagePreparationError is named alongside the API error because it
          // already words itself for the client ("try a JPG or PNG") and now
          // reaches this wrapper: P2e routes the inspiration upload through
          // `prepareImageForUpload` too, and folding its sentence into a
          // generic "something went wrong" would hide the one instruction that
          // fixes it.
          caught instanceof ConsultFlowApiError ||
            caught instanceof ImagePreparationError
            ? caught.message
            : 'Something went wrong. Please try again.',
        )
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  // ── Consent ───────────────────────────────────────────────────────────────
  const acceptAgreement = (kind: string, agreementVersionId: string) =>
    run(async () => {
      await api(`${base}/agreements/accept`, {
        method: 'POST',
        body: JSON.stringify({ kind, agreementVersionId }),
      })
    })

  // ── Intake ────────────────────────────────────────────────────────────────
  //
  // One tap answers one question, and the POST carries the WHOLE revision — so
  // the answers already in the thread are read back out of it rather than kept
  // in a second copy here that could drift from what the server holds.
  const answerIntake = (
    message: ConsultThreadQuestionMessageDTO,
    value: string,
  ) =>
    run(async () => {
      if (!thread) return
      const answers: Record<string, string> = {}
      for (const entry of thread.messages) {
        if (entry.kind === 'QUESTION' && entry.answer !== null) {
          answers[entry.question.key] = entry.answer
        }
      }
      answers[message.question.key] = value

      const saved = await api<ConsultIntakeSubmitResponseDTO>(`${base}/intake`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          packVersion: message.packVersion,
          schemaVersion: message.schemaVersion,
          complete: false,
          answers,
        }),
      })
      if (
        saved.intake.progress.canComplete &&
        saved.intake.questionPack.questions.every(
          (question) =>
            question.requirement !== 'SKIPPABLE' || answers[question.key],
        )
      ) {
        await api<ConsultIntakeSubmitResponseDTO>(`${base}/intake`, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: newKey(),
            packVersion: message.packVersion,
            schemaVersion: message.schemaVersion,
            complete: true,
            answers,
          }),
        })
      }
    })

  // ── Inspiration ───────────────────────────────────────────────────────────
  //
  // ONE signed read of the reference for the whole thread. Every card crops the
  // same URL; a read per card would be eleven requests for one photograph.
  const inspirationImage = useConsultInspirationImage(
    thread?.messages.find(
      (message): message is ConsultThreadInspirationMessageDTO =>
        message.kind === 'INSPIRATION' && Boolean(message.source?.imageAvailable),
    )?.source?.imageReadEndpoint ?? null,
  )

  const skipInspiration = (message: ConsultThreadInspirationMessageDTO) =>
    run(async () => {
      await api(`${base}/inspiration`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          source: 'NONE',
          schemaVersion: message.schemaVersion,
        }),
      })
    })

  const uploadInspiration = (
    message: ConsultThreadInspirationMessageDTO,
    file: File,
  ) =>
    run(async () => {
      // P2e — the inspiration upload was the one entry path that shipped a
      // camera-roll file's RAW bytes: full resolution, EXIF orientation
      // intact, all metadata attached, and refused outright at presign the
      // moment the file crossed 5 MB. The capture path next door has always
      // prepared its photo; this now uses the same helper, so both web entry
      // paths hand the server a 1568px, metadata-free JPEG.
      const prepared = await prepareImageForUpload(file, CONSULT_CAPTURE_MAX_BYTES)
      const bytes = await prepared.arrayBuffer()
      const issued = await api<{
        upload: { inspirationId: string; signedUrl: string | null }
      }>(`${base}/inspiration/uploads`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          schemaVersion: message.schemaVersion,
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
      await api(`${base}/inspiration/attach`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          inspirationId: issued.upload.inspirationId,
          schemaVersion: message.schemaVersion,
        }),
      })
    })

  /**
   * P5b — the inspiration READ stage.
   *
   * The reference is read by the vision model as its own step, before she is
   * asked anything about it, because P5's cards are built from that reading.
   * It is a paid call of a few seconds, so it gets its own busy flag rather
   * than the thread-wide one: the sticky Book CTA must stay live throughout.
   * Booking at the spark never waits on a model (handoff Part 2).
   */
  const readInspiration = useCallback(
    async (inspirationId: string) => {
      inspirationRead.current = inspirationId
      setReadingInspiration(true)
      setInspirationReadError(null)
      try {
        await api(`${base}/inspiration/read`, {
          method: 'POST',
          body: JSON.stringify({ idempotencyKey: newKey() }),
        })
        await refresh()
      } catch (caught) {
        // Surfaced, never swallowed (Part 0 rule 4). The server distinguishes
        // "this photograph could not be read" from "the provider is down" and
        // words each itself; this only decides where the sentence lands.
        setInspirationReadError(
          caught instanceof ConsultFlowApiError
            ? caught.message
            : 'Something went wrong. Please try again.',
        )
      } finally {
        setReadingInspiration(false)
      }
    },
    [base, refresh],
  )

  /**
   * Ask for the reading as soon as there is a reference to read.
   *
   * 🔴 Guarded by a ref holding the inspiration id it last asked for, not by a
   * boolean. A failed read leaves `analysisReady` false, so a bare "have we
   * asked?" flag either retries forever (a paid call, on a loop) or never
   * retries a swapped photo. Keyed on the id, a NEW reference is read and the
   * failed one waits for the retry button.
   */
  useEffect(() => {
    if (readingInspiration) return
    const inspiration = thread?.messages.find(
      (message) => message.kind === 'INSPIRATION',
    )
    const source = inspiration?.kind === 'INSPIRATION' ? inspiration.source : null
    if (
      !source ||
      !source.imageAvailable ||
      source.analysisReady !== false ||
      inspirationRead.current === source.inspirationId
    ) {
      return
    }
    void readInspiration(source.inspirationId)
  }, [thread, readingInspiration, readInspiration])

  /**
   * 🔴 No free text reaches this call, by construction: the thread has no text
   * input at all. A question that allows a note is answered with its own
   * tappable "nothing else" option instead, which is the value the server
   * requires when there is no note.
   */
  const answerInspiration = (
    message: ConsultThreadInspirationMessageDTO,
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
  ) =>
    run(async () => {
      const values =
        question.allowText && selectedValues.length === 0
          ? ['nothing-else']
          : selectedValues
      await api(`${base}/inspiration/answers`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: newKey(),
          schemaVersion: message.schemaVersion,
          questionKey: question.key,
          selectedValues: values,
        }),
      })
    })

  // ── Photos ────────────────────────────────────────────────────────────────
  const setSlotPreview = useCallback((shotKey: string, blob: Blob) => {
    setSlotPreviews((current) => {
      const previous = current[shotKey]
      if (previous) URL.revokeObjectURL(previous)
      return { ...current, [shotKey]: URL.createObjectURL(blob) }
    })
  }, [])

  const uploadShot = (
    message: ConsultThreadPhotoRequestMessageDTO,
    file: File,
  ) =>
    run(async () => {
      const shot = message.shot
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
            shotPackVersion: message.shotPackVersion,
            schemaVersion: message.schemaVersion,
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
        const attached = await api<{ captureId: string }>(
          `${base}/capture/attach`,
          {
            method: 'POST',
            body: JSON.stringify({
              idempotencyKey: newKey(),
              uploadSessionId: issued.upload.uploadSessionId,
              shotKey: shot.key,
              shotPackVersion: message.shotPackVersion,
              schemaVersion: message.schemaVersion,
            }),
          },
        )
        // The photo is on the server now — keep the local copy reviewable even
        // if the quality verdict rejects (and purges) the server's copy.
        setSlotPreview(shot.key, prepared)
        await api(
          `${base}/capture/${encodeURIComponent(attached.captureId)}/quality`,
          {
            method: 'POST',
            body: JSON.stringify({
              idempotencyKey: newKey(),
              shotPackVersion: message.shotPackVersion,
              schemaVersion: message.schemaVersion,
            }),
          },
        )
      } catch (caught) {
        // Bind the failure to the photo message it belongs to, not to a
        // page-top banner she has already scrolled past.
        const message_ =
          caught instanceof ConsultFlowApiError ||
          caught instanceof ImagePreparationError
            ? caught.message
            : 'Something went wrong with this photo. Try again.'
        setSlotErrors((current) => ({ ...current, [shot.key]: message_ }))
      }
    })

  const proceedWithAccepted = () =>
    run(async () => {
      await api(`${base}/capture/proceed`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    })

  const setChartCopy = (optIn: boolean) =>
    run(async () => {
      await api(`${base}/capture/chart-copy`, {
        method: 'POST',
        body: JSON.stringify({ optIn }),
      })
    })

  // ── Analysis (P4b) ────────────────────────────────────────────────────────
  // The POST claims the analysis and returns a run in a fraction of a second.
  // Everything after that is the poll below.
  const startAnalysis = (message: ConsultThreadPlanMessageDTO) =>
    run(async () => {
      if (message.schemaVersion === null || message.promptVersion === null) {
        return
      }
      setAnalyzing(true)
      try {
        await api(`${base}/analysis`, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: analysisKey.current,
            schemaVersion: message.schemaVersion,
            promptVersion: message.promptVersion,
          }),
        })
      } finally {
        setAnalyzing(false)
      }
    })

  // ── The poll ──────────────────────────────────────────────────────────────
  // Every 5s while a run is live and this screen is mounted. Stops on its own
  // when the run settles. Unlike the wizard this replaces, a completed run does
  // NOT route away: the plan lands in the thread and the thread stays open.
  //
  // `document.hidden` is checked per tick rather than by subscribing to the
  // visibility event: a backgrounded tab should not keep asking, and the tick
  // that runs when it comes back is the catch-up.
  const planMessage = thread?.messages.find(
    (entry): entry is ConsultThreadPlanMessageDTO => entry.kind === 'PLAN',
  )
  const analysisRun = planMessage?.run ?? null
  const runIsLive = analysisRun ? isConsultAnalysisRunLive(analysisRun) : false
  useEffect(() => {
    if (!runIsLive) return
    let cancelled = false

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        if (cancelled) return
        await refresh()
      } catch {
        // A dropped poll is not a failed analysis — the run keeps going on the
        // server and the next tick asks again. Surfacing an error here would
        // tell the client something is wrong when nothing is.
      }
    }

    const timer = setInterval(
      () => void tick(),
      CONSULT_ANALYSIS_POLL_INTERVAL_MS,
    )
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh, runIsLive])

  // ── Render ────────────────────────────────────────────────────────────────
  if (!thread) {
    return (
      <div className="grid gap-4">
        <ErrorNote message={error} />
        <p className="text-sm text-textSecondary">Loading your consult…</p>
      </div>
    )
  }

  return (
    <ThreadShell
      openMessageId={thread.nextOpenMessageId}
      footer={
        <BookTheLookCta
          thread={thread}
          copy={copy}
          busy={busy}
          onBook={() => router.push(bookTheLookHref(thread))}
        />
      }
    >
      <ErrorNote message={error} />
      {inspirationFullscreen && inspirationImage.url ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-scrim/80 p-4"
          data-testid="consult-inspiration-fullscreen"
        >
          <div className="w-full max-w-lg">
            <ZoomableImage
              src={inspirationImage.url}
              alt="Your inspiration photo"
            />
            <button
              type="button"
              className={`${BUTTON_SECONDARY} mt-3`}
              onClick={() => setInspirationFullscreen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      {thread.messages.map((message) => (
        <ThreadMessageSlot key={message.id} id={message.id}>
          <ConsultThreadMessage
            message={message}
            busy={busy}
            analyzing={analyzing}
            slotPreviews={slotPreviews}
            slotErrors={slotErrors}
            onAcceptAgreement={acceptAgreement}
            onAnswerIntake={answerIntake}
            onSkipInspiration={skipInspiration}
            onUploadInspiration={uploadInspiration}
            onAnswerInspiration={answerInspiration}
            copy={copy}
            inspirationImage={inspirationImage}
            onOpenInspirationFull={() => setInspirationFullscreen(true)}
            readingInspiration={readingInspiration}
            inspirationReadError={inspirationReadError}
            onRetryInspirationRead={readInspiration}
            onUploadShot={uploadShot}
            onStartAnalysis={startAnalysis}
            onRefresh={() => void refresh()}
          />
        </ThreadMessageSlot>
      ))}
      <CapturePrepControls
        thread={thread}
        busy={busy}
        copy={copy}
        pro={thread.professionalDisplayName}
        onChartCopy={setChartCopy}
        onProceed={proceedWithAccepted}
      />
    </ThreadShell>
  )
}

// ── The consult SCRIPT ───────────────────────────────────────────────────────
//
// One renderer per message kind. Everything above this line is state and
// mutations; everything below is "what does this step look like as a message".
// The shell (./_thread/ThreadShell) knows none of it, which is what lets the
// pro-side mentor reuse the shell with a different script.

function ConsultThreadMessage({
  message,
  busy,
  analyzing,
  slotPreviews,
  slotErrors,
  onAcceptAgreement,
  onAnswerIntake,
  onSkipInspiration,
  onUploadInspiration,
  onAnswerInspiration,
  copy,
  inspirationImage,
  onOpenInspirationFull,
  readingInspiration,
  inspirationReadError,
  onRetryInspirationRead,
  onUploadShot,
  onStartAnalysis,
  onRefresh,
}: {
  message: ConsultThreadMessageDTO
  busy: boolean
  analyzing: boolean
  slotPreviews: Record<string, string>
  slotErrors: Record<string, string>
  onAcceptAgreement: (kind: string, agreementVersionId: string) => void
  onAnswerIntake: (
    message: ConsultThreadQuestionMessageDTO,
    value: string,
  ) => void
  onSkipInspiration: (message: ConsultThreadInspirationMessageDTO) => void
  onUploadInspiration: (
    message: ConsultThreadInspirationMessageDTO,
    file: File,
  ) => void
  copy: BrandClientConsultThreadCopy
  /** The ONE signed read of the reference, shared by every card. */
  inspirationImage: ReturnType<typeof useConsultInspirationImage>
  onOpenInspirationFull: () => void
  readingInspiration: boolean
  inspirationReadError: string | null
  onRetryInspirationRead: (inspirationId: string) => void
  onAnswerInspiration: (
    message: ConsultThreadInspirationMessageDTO,
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
  ) => void
  onUploadShot: (
    message: ConsultThreadPhotoRequestMessageDTO,
    file: File,
  ) => void
  onStartAnalysis: (message: ConsultThreadPlanMessageDTO) => void
  onRefresh: () => void
}) {
  switch (message.kind) {
    case 'TEXT':
      return (
        <ThreadBubble author={message.author}>{message.text}</ThreadBubble>
      )

    case 'BOOKING':
      return <ThreadBubble author="APP">{message.text}</ThreadBubble>

    case 'CONSENT':
      return (
        <ConsentMessage
          message={message}
          busy={busy}
          onAccept={onAcceptAgreement}
        />
      )

    case 'QUESTION':
      return (
        <QuestionMessage
          message={message}
          busy={busy}
          onAnswer={onAnswerIntake}
        />
      )

    case 'INSPIRATION':
      // A CARD message renders as a card; the step's own message (the one that
      // asks for a reference and carries the read state) renders as before.
      return message.card ? (
        <InspirationCardMessage
          message={message}
          card={message.card}
          busy={busy}
          image={inspirationImage}
          onAnswer={onAnswerInspiration}
          onOpenFull={onOpenInspirationFull}
        />
      ) : (
        <InspirationMessage
          message={message}
          busy={busy}
          copy={copy}
          image={inspirationImage}
          reading={readingInspiration}
          readError={inspirationReadError}
          onRetryRead={onRetryInspirationRead}
          onSkip={onSkipInspiration}
          onUpload={onUploadInspiration}
          onAnswer={onAnswerInspiration}
        />
      )

    case 'PHOTO_REQUEST':
      return (
        <PhotoRequestMessage
          message={message}
          busy={busy}
          preview={slotPreviews[message.shot.key]}
          error={slotErrors[message.shot.key]}
          onUpload={onUploadShot}
        />
      )

    case 'PLAN':
      return (
        <PlanMessage
          message={message}
          busy={busy}
          analyzing={analyzing}
          onStart={onStartAnalysis}
          onRefresh={onRefresh}
        />
      )

    case 'PLAN_UPDATE':
      return <PlanUpdateMessage message={message} />
  }
}

/**
 * P7a-3 — "your plan moved, and here is what changed".
 *
 * A bubble, not a card: it is the app telling her something, not asking. The
 * diff rows sit inside it as a small table so a change she cares about
 * ("one visit → more than one visit") is legible at a glance, which is the
 * whole reason the server sends labelled rows rather than prose.
 *
 * 🔴 An empty `changes` list still renders. The server sends its own sentence
 * for that case ("I looked again — the plan still holds"), and swallowing the
 * bubble would make her edit look ignored.
 */
function PlanUpdateMessage({
  message,
}: {
  message: ConsultThreadPlanUpdateMessageDTO
}) {
  return (
    <ThreadBubble author={message.author}>
      <div
        className="grid gap-2"
        data-testid="consult-plan-update"
        data-plan-version={message.planVersion}
      >
        <span>{message.text}</span>
        {message.changes.length > 0 ? (
          <dl className="grid gap-1.5 rounded-xl bg-surfaceGlass/10 p-2.5">
            {message.changes.map((change) => (
              <div
                key={change.key}
                className="grid gap-0.5"
                data-testid="consult-plan-change"
                data-change-key={change.key}
              >
                <dt className="text-[11px] font-semibold text-textMuted">
                  {change.label}
                </dt>
                <dd className="text-[12.5px] font-semibold text-textPrimary">
                  <span className="text-textMuted line-through">
                    {change.from ?? '—'}
                  </span>{' '}
                  &rarr; {change.to ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </ThreadBubble>
  )
}

function ConsentMessage({
  message,
  busy,
  onAccept,
}: {
  message: ConsultThreadConsentMessageDTO
  busy: boolean
  onAccept: (kind: string, agreementVersionId: string) => void
}) {
  return (
    <div className="grid gap-3">
      <ThreadBubble author="APP">{message.text}</ThreadBubble>
      {message.requirements.map((requirement) => {
        const accepted = Boolean(requirement.currentAcceptance)
        return (
          <ThreadCard key={requirement.kind} dimmed={accepted}>
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
                onAccept(requirement.kind, requirement.requiredVersion.id)
              }
            >
              {accepted ? 'Agreed' : 'I agree'}
            </button>
          </ThreadCard>
        )
      })}
    </div>
  )
}

/**
 * One intake question, one message.
 *
 * An ANSWERED question keeps its card — dimmed — and gains the client's own
 * answer as a bubble on her side. That echo is the point: a thread you can
 * scroll back through is the difference between a conversation and a form.
 */
function QuestionMessage({
  message,
  busy,
  onAnswer,
}: {
  message: ConsultThreadQuestionMessageDTO
  busy: boolean
  onAnswer: (
    message: ConsultThreadQuestionMessageDTO,
    value: string,
  ) => void
}) {
  const { question, answer } = message
  const answeredLabel =
    answer === null
      ? null
      : (question.options.find((option) => option.value === answer)?.label ??
        answer)

  return (
    <div className="grid gap-2">
      <ThreadCard dimmed={answer !== null}>
        <h3 className="text-base font-black text-textPrimary">
          {question.label}
        </h3>
        {question.helpText ? (
          <p className="mt-2 text-sm leading-6 text-textSecondary">
            {question.helpText}
          </p>
        ) : null}
        {answer === null ? (
          <div className="mt-3 grid gap-2">
            {question.options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={busy}
                className={`${BUTTON_SECONDARY} text-left`}
                onClick={() => onAnswer(message, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </ThreadCard>
      {answeredLabel ? (
        <ThreadBubble author="CLIENT">{answeredLabel}</ThreadBubble>
      ) : null}
    </div>
  )
}

/**
 * The inspiration card.
 *
 * P5a renders the CURRENT v1 questions inside a card; P5 replaces the content
 * with the zoom-card script (a crop of the attribute's region + "is this part
 * of what you like?"). The card is what is being fixed in place here, not the
 * wording inside it.
 */
function InspirationMessage({
  message,
  busy,
  copy,
  image,
  reading,
  readError,
  onRetryRead,
  onSkip,
  onUpload,
  onAnswer,
}: {
  message: ConsultThreadInspirationMessageDTO
  busy: boolean
  copy: BrandClientConsultThreadCopy
  image: ReturnType<typeof useConsultInspirationImage>
  /** P5b: the vision read of this reference is in flight. */
  reading: boolean
  /** The server's own words for why the read failed, or null. */
  readError: string | null
  onRetryRead: (inspirationId: string) => void
  onSkip: (message: ConsultThreadInspirationMessageDTO) => void
  onUpload: (
    message: ConsultThreadInspirationMessageDTO,
    file: File,
  ) => void
  onAnswer: (
    message: ConsultThreadInspirationMessageDTO,
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
  ) => void
}) {
  const done = message.state === 'DONE'
  // Bound once rather than re-narrowed at each use: the retry handler needs the
  // id, and a non-null assertion inside a callback is exactly where a later
  // edit turns a narrowed value back into `undefined` without the compiler
  // noticing.
  const source = message.source
  return (
    <div className="grid gap-2">
      {message.text ? (
        <ThreadBubble author="APP">{message.text}</ThreadBubble>
      ) : null}
      {done ? null : (
        <ThreadCard>
          {message.sourceDecisionRequired ? (
            <div className="grid gap-3">
              <label className={`inline-block cursor-pointer ${BUTTON_PRIMARY}`}>
                Add a photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onUpload(message, file)
                    event.target.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                className={`${BUTTON_SECONDARY} justify-self-start`}
                disabled={busy}
                onClick={() => onSkip(message)}
              >
                Carry on without one
              </button>
            </div>
          ) : null}

          {message.source ? (
            <InspirationImagePanel source={message.source} image={image} />
          ) : null}

          {/* P5b — the read stage, under the picture it is reading. It is not
              a blocker: the questions below stay answerable and the sticky
              Book CTA is untouched, because nothing the client can do should
              wait on a model. */}
          {source && reading ? (
            <p
              className="mt-3 text-xs leading-5 text-textSecondary"
              data-testid="consult-inspiration-reading"
            >
              {copy.inspirationReading}
            </p>
          ) : null}
          {source && !reading && readError ? (
            <div
              className="mt-3 rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-3 py-2"
              data-testid="consult-inspiration-read-error"
            >
              <p className="text-xs leading-5 text-textPrimary">{readError}</p>
              <button
                type="button"
                className={`${BUTTON_SECONDARY} mt-2`}
                disabled={busy}
                onClick={() => onRetryRead(source.inspirationId)}
              >
                {copy.inspirationReadRetryLabel}
              </button>
            </div>
          ) : null}

          {message.specificDetailCount < message.requiredSpecificDetailCount &&
          message.answeredQuestionCount > 0 ? (
            <p className="mt-3 rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-3 py-2 text-xs leading-5 text-textPrimary">
              Pick out at least {message.requiredSpecificDetailCount} specific
              details you love or want to avoid — answers like “not sure” don’t
              give your professional anything to work from, so a couple of
              questions come back around.
            </p>
          ) : null}

          {message.question ? (
            <InspirationQuestionForm
              key={message.question.key}
              question={message.question}
              busy={busy}
              onAnswer={(question, values) =>
                onAnswer(message, question, values)
              }
            />
          ) : null}
        </ThreadCard>
      )}
    </div>
  )
}

/**
 * A photo request, and the badge that comes back with it.
 *
 * 🔴 The badge ladder is the P2d one, LIFTED rather than rewritten: EMPTY →
 * "Add photo", UPLOADED → "Checking…", ACCEPTED → "Passed", REJECTED →
 * "Retake" with the server's own reason and tip. Every state below is a served
 * slot state; nothing here invents one.
 */
function PhotoRequestMessage({
  message,
  busy,
  preview,
  error,
  onUpload,
}: {
  message: ConsultThreadPhotoRequestMessageDTO
  busy: boolean
  preview: string | undefined
  error: string | undefined
  onUpload: (
    message: ConsultThreadPhotoRequestMessageDTO,
    file: File,
  ) => void
}) {
  const { shot, slot } = message
  const accepted = slot.state === 'ACCEPTED'
  const badge = photoBadge(slot.state)

  return (
    <ThreadCard dimmed={accepted}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-textPrimary">{shot.title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-textSecondary">
            {shot.instruction}
          </p>
        </div>
        {preview ? (
          <RemoteImage
            src={preview}
            alt={`Your ${shot.title} photo`}
            intrinsic
            className="h-16 w-16 shrink-0 rounded-lg border border-surfaceGlass/20 object-cover"
          />
        ) : null}
      </div>

      {slot.state === 'REJECTED' ? (
        <div className="mt-2 rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-2 py-1.5 text-xs leading-5 text-textPrimary">
          {slot.qualityReasonCode
            ? QUALITY_REASON_COPY[slot.qualityReasonCode]
            : QUALITY_REASON_COPY.OTHER_QUALITY_FAILURE}
          {slot.retakeTip ? ` ${slot.retakeTip}` : null}
        </div>
      ) : null}

      {slot.qualityWarningCode && accepted ? (
        <div className="mt-2 rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-2 py-1.5 text-xs leading-5 text-textPrimary">
          {QUALITY_REASON_COPY[slot.qualityWarningCode]} We can still use it.
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-lg border border-toneDanger/30 bg-toneDanger/10 px-2 py-1.5 text-xs leading-5 text-textPrimary">
          {error}
        </p>
      ) : null}

      <label
        className={`mt-3 inline-block cursor-pointer ${
          accepted ? BUTTON_SECONDARY : BUTTON_PRIMARY
        }`}
      >
        {accepted ? 'Replace this photo' : badge.action}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUpload(message, file)
            event.target.value = ''
          }}
        />
      </label>
    </ThreadCard>
  )
}

/**
 * The served slot state, as a badge and a button label.
 *
 * UPLOADED is deliberately its own state and not "not taken yet": it means the
 * server holds bytes with no verdict, and telling the client to do again the
 * thing she has already done is exactly the failure the P2d ladder exists to
 * prevent.
 */
function photoBadge(state: ConsultCaptureSlotStateDTO['state']): {
  label: string
  action: string
  className: string
} {
  switch (state) {
    case 'ACCEPTED':
      return {
        label: 'Passed',
        action: 'Replace this photo',
        className: 'bg-toneSuccess/15 text-toneSuccess',
      }
    case 'REJECTED':
      return {
        label: 'Retake',
        action: 'Take another',
        className: 'bg-toneWarn/15 text-toneWarn',
      }
    case 'UPLOADED':
      return {
        label: 'Checking',
        action: 'Send a different one',
        className: 'bg-toneInfo/15 text-toneInfo',
      }
    case 'EXPIRED':
    case 'PURGED':
      return {
        label: 'Send again',
        action: 'Add this photo again',
        className: 'bg-toneWarn/15 text-toneWarn',
      }
    case 'EMPTY':
      return {
        label: 'Needed',
        action: 'Add photo',
        className: 'bg-surfaceGlass/10 text-textMuted',
      }
  }
}

/** The plan card — the reveal. P5a renders the existing analysis result. */
function PlanMessage({
  message,
  busy,
  analyzing,
  onStart,
  onRefresh,
}: {
  message: ConsultThreadPlanMessageDTO
  busy: boolean
  analyzing: boolean
  onStart: (message: ConsultThreadPlanMessageDTO) => void
  onRefresh: () => void
}) {
  return (
    <div className="grid gap-2">
      <ThreadBubble author="APP">{message.text}</ThreadBubble>
      {/*
        🔴 Only when the card has something IN it. `run`, `awaitingStart` and
        `results` can all be falsy at once — a completed consult whose results
        the serve gate declines to show — and the card then rendered as an empty
        white box between two bubbles. Caught in a browser; invisible to every
        test that asserts on text, because there is no text to assert on.
      */}
      {message.run || message.awaitingStart || message.results ? (
      <ThreadCard>
        {message.run ? (
          <AnalysisRunProgress
            run={message.run}
            busy={busy || analyzing}
            onRetry={() => onStart(message)}
            onRefresh={onRefresh}
          />
        ) : message.awaitingStart ? (
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={busy || analyzing}
            onClick={() => onStart(message)}
          >
            {analyzing ? 'Starting…' : 'Build my plan'}
          </button>
        ) : null}

        {message.results ? (
          <div className="grid gap-3">
            <PlanSummary results={message.results} />
            <a
              className={`${BUTTON_SECONDARY} justify-self-start`}
              href={`/client/consult/${encodeURIComponent(
                message.results.consultId,
              )}/results`}
            >
              See the whole plan
            </a>
          </div>
        ) : null}
      </ThreadCard>
      ) : null}
    </div>
  )
}

/**
 * The plan card's PLACEHOLDER body (P5a).
 *
 * It shows the analysis's own headline directions and sends the client to the
 * full results page for the rest. The versioned plan card the handoff describes
 * — the reveal, with its own history — is later work, and inventing half of it
 * here would be a second thing to migrate.
 */
function PlanSummary({
  results,
}: {
  results: NonNullable<ConsultThreadPlanMessageDTO['results']>
}) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-black text-textPrimary">
        {results.directionsTitle}
      </h3>
      <ul className="grid gap-1">
        {results.recommendationDirections.slice(0, 3).map((direction) => (
          <li key={direction.title} className="text-sm leading-6 text-textPrimary">
            {direction.title}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The two capture-step controls that are NOT steps: the chart-copy preference
 * she can flip at any point in the window, and the offer to run the analysis on
 * the photos that were accepted.
 *
 * They sit under the thread rather than inside a message because neither is a
 * question with an answer — turning either into a bubble would put a message in
 * the history that she can change after the fact.
 */
function CapturePrepControls({
  thread,
  busy,
  copy,
  pro,
  onChartCopy,
  onProceed,
}: {
  thread: ConsultThreadDTO
  busy: boolean
  copy: BrandClientConsultThreadCopy
  pro: string
  onChartCopy: (optIn: boolean) => void
  onProceed: () => void
}) {
  // 🔴 The EARLY photo is excluded, and it is the same correction the server
  // makes in `advanceLockedConsultToAnalysisIfReady` (P7a-1): this card is
  // about the GUIDED pack — "you have some of your photos in, run it anyway" —
  // so counting a photograph that is not one of its slots would report a
  // seven-shot pack as 8-of-8 complete after seven guided shots, and would
  // offer "proceed with a partial pack" to a client who has taken no guided
  // photo at all. The server still permits an analysis on the early photo
  // alone; this is the card that describes the pack.
  const photos = thread.messages.filter(
    (entry): entry is ConsultThreadPhotoRequestMessageDTO =>
      entry.kind === 'PHOTO_REQUEST' &&
      entry.shot.key !== CONSULT_EARLY_PHOTO_SHOT_KEY,
  )
  if (photos.length === 0 || !thread.chartCopy) return null

  const accepted = photos.filter(
    (entry) => entry.slot.state === 'ACCEPTED',
  ).length
  const canProceed =
    thread.status === 'MEDIA_READY' && accepted >= 1 && accepted < photos.length

  return (
    <div className="grid gap-3">
      <ThreadCard>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={thread.chartCopy.optIn}
            disabled={busy}
            onChange={(event) => onChartCopy(event.target.checked)}
          />
          {/*
            🔴 From the copy table, and REWRITTEN by P7a-3. The shipped sentence
            said "photos are deleted after analysis either way", which stopped
            being true the day retention shipped: with this ticked they are kept
            through the appointment so the plan can be reworked. A consent
            control that misdescribes what it consents to is worse than none.
          */}
          <span className="text-sm leading-6 text-textPrimary">
            {fillConsultThreadCopy(copy.chartCopyLabel, { pro })}
          </span>
        </label>
      </ThreadCard>
      {canProceed ? (
        <ThreadCard>
          <p className="text-sm leading-6 text-textSecondary">
            You can keep going with the photos that came through. The views you
            skip can’t be analyzed, so those parts of your plan will honestly
            say unknown.
          </p>
          <button
            type="button"
            className={`mt-3 ${BUTTON_SECONDARY}`}
            disabled={busy}
            onClick={onProceed}
          >
            Carry on with {accepted} of {photos.length} photos
          </button>
        </ThreadCard>
      ) : null}
    </div>
  )
}

/**
 * Where the sticky CTA sends her: the ORDINARY look-booking path.
 *
 * 🔴 NOT the consult proposal route. That one refuses with ESTIMATE_MISSING
 * until the analysis commits an estimate, and the analysis takes ~100s — longer
 * than the spark lasts. The look's own booking entry books instantly at the
 * pro's menu starting price, which is what "book at the spark" means; the
 * consult then continues as prep.
 */
function bookTheLookHref(thread: ConsultThreadDTO): string {
  const params = new URLSearchParams()
  if (thread.book.serviceId) params.set('serviceId', thread.book.serviceId)
  if (thread.book.lookMediaId) params.set('mediaId', thread.book.lookMediaId)
  params.set('source', 'DISCOVERY')

  // 🔴 `book=1` is what actually opens the availability drawer — the look page
  // reads that ONE param (LookDetailClient). This used to end in `#book`, a
  // fragment nothing reads and the server never sees, so the sticky CTA landed
  // on the look page with no drawer and the spark simply died there. Verified
  // in a browser before the fix: at the old href the drawer stayed closed.
  params.set('book', '1')

  // P7a-2 — the consult id travels with the tap. The look page passes it into
  // the drawer, the drawer into the finalize body, and the write boundary
  // validates it before stamping the link. It is a CLAIM on the wire: the
  // server re-derives ownership, the pro and the look before believing it.
  //
  // Its presence is also what tells the look page NOT to re-ask
  // `resolveLookConsultEntry`: that helper resolves a live consult back to
  // `/client/consult/[id]`, which is the page we are leaving — arriving with it
  // would bounce straight back here and the client would never reach a drawer.
  params.set('sparkConsultId', thread.consultId)

  return `/looks/${encodeURIComponent(thread.book.lookPostId ?? '')}?${params.toString()}`
}

/**
 * The sticky Book the look button.
 *
 * Disabled until one selfie is in, and it SAYS why — a dead button with no
 * explanation is the thing that makes a client think the app is broken.
 */
function BookTheLookCta({
  thread,
  copy,
  busy,
  onBook,
}: {
  thread: ConsultThreadDTO
  copy: BrandClientConsultThreadCopy
  busy: boolean
  onBook: () => void
}) {
  const { book } = thread
  // A booking-anchored consult already HAS its appointment, and a stopped one
  // has nothing to book. Neither gets a button at all — a permanently disabled
  // CTA reads as a bug, not as a rule.
  if (book.reason === 'NOT_LOOK_ANCHORED' || book.reason === 'CONSULT_STOPPED') {
    return null
  }
  if (book.reason === 'ALREADY_BOOKED') return null

  return (
    <div className="grid gap-2">
      <button
        type="button"
        data-testid="consult-thread-book-cta"
        className={`${BUTTON_PRIMARY} w-full`}
        disabled={!book.enabled || busy}
        onClick={onBook}
      >
        {copy.bookCtaLabel}
      </button>
      {book.reason === 'SELFIE_REQUIRED' ? (
        <p className="text-center text-xs text-textMuted">
          {copy.bookCtaSelfieRequired}
        </p>
      ) : null}
      {book.reason === 'LOOK_NOT_BOOKABLE' ? (
        <p className="text-center text-xs text-textMuted">
          {copy.bookCtaNotBookable}
        </p>
      ) : null}
    </div>
  )
}
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
/**
 * The ONE signed read of the client's reference, for the whole thread.
 *
 * 🔴 Lifted out of the panel in P5d, and the reason is arithmetic: the thread
 * now renders up to eleven card messages, each of which shows a crop of the
 * same photograph. A per-message read would be eleven requests against a
 * force-dynamic route for one image — the shape of the refetch bug P1 fixed,
 * arrived at from the other direction. One read, one renewal timer, every crop
 * pointed at the same URL.
 */
function useConsultInspirationImage(endpoint: string | null): {
  url: string | null
  failed: boolean
  retry: () => void
} {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // The ONLY thing that starts a read. It advances on mount, on an endpoint
  // change, and from exactly two places: the renewal timer a SUCCESSFUL read
  // scheduled, and the user's Retry press. A failure advances nothing, so a
  // persistently broken read costs one request, not a loop.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // No reference on this thread: nothing to read, and nothing to clear —
    // the values are DERIVED from `endpoint` below rather than written here,
    // so a consult whose reference goes away cannot keep painting a stale URL.
    if (!endpoint) return
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

  return {
    url: endpoint ? signedUrl : null,
    failed: endpoint ? failed : false,
    retry: () => {
      // Clearing `failed` swaps the alert for the loading line, so the press
      // has visible feedback without a second flag.
      setFailed(false)
      setAttempt((value) => value + 1)
    },
  }
}

function InspirationImagePanel({
  source,
  image,
}: {
  source: NonNullable<ConsultInspirationStateDTO['source']>
  image: ReturnType<typeof useConsultInspirationImage>
}) {
  const { url: signedUrl, failed } = image
  if (!source.imageAvailable) return null
  return (
    <div className="mt-4 grid gap-2">
      {signedUrl ? (
        <ZoomableImage src={signedUrl} alt="Your inspiration photo" />
      ) : failed ? (
        <div
          role="alert"
          data-testid="consult-inspiration-image-error"
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
            <button type="button" className={BUTTON_SECONDARY} onClick={image.retry}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-textSecondary">
          Loading your inspiration photo…
        </p>
      )}
    </div>
  )
}


/**
 * P5d — a CROP of the client's reference, sized to one region of it.
 *
 * The region arrives normalized (0..1 of the image), and the crop is done in
 * CSS from ONE already-loaded image rather than by asking a server for a cut
 * version: the reference is short-lived signed media, and cropping it
 * server-side would be a second render path and a second thing to purge.
 *
 * 🔴 The natural size is measured through a REF, not `onLoad`. React does not
 * fire `onLoad` for an `<img>` that was already `complete` when the handler
 * attached — which is the normal case here, because every card after the first
 * shows the same cached photograph. A crop that waited for `onLoad` would sit
 * blank on exactly the cards the client scrolls to second.
 *
 * Without a measurement the box falls back to a square, which crops honestly
 * (the right part of the picture) and only distorts its aspect — visibly worse
 * than the measured version, never wrong about WHAT it is showing.
 */
function InspirationRegionCrop({
  src,
  region,
  alt,
  onOpen,
}: {
  src: string
  region: { x: number; y: number; w: number; h: number } | null
  alt: string
  onOpen: () => void
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const measure = useCallback((element: HTMLImageElement | null) => {
    if (element?.complete && element.naturalWidth > 0) {
      setNatural({ w: element.naturalWidth, h: element.naturalHeight })
    }
  }, [])

  const box =
    region && region.w > 0 && region.h > 0
      ? {
          // The sprite-crop formula: scale the image up so the region fills the
          // box, then slide it so the region's own offset is what shows.
          backgroundImage: `url(${JSON.stringify(src)})`,
          backgroundSize: `${100 / region.w}% ${100 / region.h}%`,
          backgroundPosition: `${
            region.w >= 1 ? 50 : (region.x / (1 - region.w)) * 100
          }% ${region.h >= 1 ? 50 : (region.y / (1 - region.h)) * 100}%`,
          backgroundRepeat: 'no-repeat',
          aspectRatio: natural
            ? `${region.w * natural.w} / ${region.h * natural.h}`
            : '1 / 1',
        }
      : {
          backgroundImage: `url(${JSON.stringify(src)})`,
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          aspectRatio: natural ? `${natural.w} / ${natural.h}` : '1 / 1',
        }

  return (
    <>
      {/* Measured only. The visible crop is the div below, which paints the
          same (already fetched) URL as a background. */}
      <img
        ref={measure}
        src={src}
        alt=""
        aria-hidden
        onLoad={(event) =>
          setNatural({
            w: event.currentTarget.naturalWidth,
            h: event.currentTarget.naturalHeight,
          })
        }
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${alt} — tap to see the whole photo`}
        data-testid="consult-inspiration-crop"
        className="block w-full overflow-hidden rounded-xl border border-surfaceGlass/10 bg-bgSurface"
        style={box}
      />
    </>
  )
}

/**
 * P5d — ONE inspiration card: the crop, then the plain word for it, then the
 * question.
 *
 * 🔴 The order on screen is the order in that sentence, and it is the Stage 2
 * rule: no jargon before its picture. She is looking at the silvery part of her
 * own reference before anything calls it "ash", and the word is offered
 * ("some people call it") rather than assumed.
 *
 * The coarse spark card is the one whose OPTIONS each carry a crop, so it
 * renders a small strip of them: the difference between "the color" and "the
 * shape of it" is a thing to SEE, not to read.
 */
function InspirationCardMessage({
  message,
  card,
  busy,
  image,
  onAnswer,
  onOpenFull,
}: {
  message: ConsultThreadInspirationMessageDTO
  card: ConsultInspirationCardDTO
  busy: boolean
  image: ReturnType<typeof useConsultInspirationImage>
  onAnswer: (
    message: ConsultThreadInspirationMessageDTO,
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
  ) => void
  onOpenFull: () => void
}) {
  const answered = card.selectedValues.length > 0
  const optionCrops = card.optionRegions.filter((option) => option.region !== null)
  return (
    <ThreadCard dimmed={answered}>
      {image.url ? (
        <div className="relative grid gap-2">
          <InspirationRegionCrop
            src={image.url}
            region={card.region}
            alt={card.name ?? 'Part of your inspiration photo'}
            onOpen={onOpenFull}
          />
          {optionCrops.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {optionCrops.map((option) => (
                <div key={option.value} className="grid gap-1">
                  <InspirationRegionCrop
                    src={image.url!}
                    region={option.region}
                    alt={option.label}
                    onOpen={onOpenFull}
                  />
                  <p
                    className="text-center text-[11px] leading-4 text-textSecondary"
                    data-testid="consult-inspiration-option-label"
                  >
                    {option.label}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : image.failed ? (
        // Surfaced, never silent: she is being asked about a picture, so if we
        // cannot put it in front of her she is told, and the question stays
        // answerable from the photo she remembers.
        <div
          role="alert"
          data-testid="consult-inspiration-card-image-error"
          className="rounded-lg border border-toneWarn/30 bg-toneWarn/10 px-3 py-2"
        >
          <p className="text-xs leading-5 text-textPrimary">
            We couldn’t load your inspiration photo for this one.
          </p>
          <button
            type="button"
            className={`${BUTTON_SECONDARY} mt-2`}
            onClick={image.retry}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* 🔴 UNDER the crop. Never above it. */}
      {card.name ? (
        <p
          className="mt-3 text-sm leading-6 text-textPrimary"
          data-testid="consult-inspiration-card-name"
        >
          {card.name}
        </p>
      ) : null}

      <p
        className="mt-2 text-sm font-bold text-textPrimary"
        data-testid="consult-inspiration-card-prompt"
      >
        {card.question.label}
      </p>

      {answered ? (
        <p className="mt-2 text-xs leading-5 text-textSecondary">
          {card.question.options
            .filter((option) => card.selectedValues.includes(option.value))
            .map((option) => option.label)
            .join(', ')}
        </p>
      ) : (
        <InspirationQuestionForm
          key={`${card.questionKey}:${card.selectedValues.join(',')}`}
          question={card.question}
          busy={busy}
          showLabel={false}
          onAnswer={(question, values) => onAnswer(message, question, values)}
        />
      )}
    </ThreadCard>
  )
}

/**
 * The inspiration question, as taps only.
 *
 * 🔴 The free-text note and its GOOD/BAD/BOTH sentiment picker are GONE from
 * the thread (P5a: "no free-text input"). Nothing is lost from the contract:
 * every question that allowed a note also carries a tappable option, and the
 * server treats a blank note as that option. What the removal buys is the
 * property that makes a scripted thread worth having — every prompt is
 * deterministic, instant, and free per message.
 */
function InspirationQuestionForm({
  question,
  busy,
  showLabel = true,
  onAnswer,
}: {
  question: ConsultInspirationQuestionDTO
  busy: boolean
  /**
   * 🔴 False on a CARD, which renders the question itself — after its crop and
   * its plain-language name, which is the whole point of the card's ordering.
   * Left true it renders a SECOND copy of the same sentence, above the name,
   * putting the jargon-free word after a question the client has already been
   * asked. Caught in a browser (tests/e2e/consult-inspiration-cards.spec.ts);
   * no unit test could see it, because both copies are correct on their own.
   */
  showLabel?: boolean
  onAnswer: (
    question: ConsultInspirationQuestionDTO,
    selectedValues: string[],
  ) => void
}) {
  const [selected, setSelected] = useState<string[]>([])

  const needsSelection =
    question.kind !== 'TEXT' && selected.length < question.minSelections

  const toggleOption = (value: string) => {
    setSelected((current) => {
      if (question.kind === 'SINGLE_SELECT' || question.kind === 'TEXT') {
        return [value]
      }
      if (current.includes(value)) {
        return current.filter((entry) => entry !== value)
      }
      // The server refuses a neutral choice ("None", "Not sure", "Nothing
      // else") combined with anything else — keep the selection consistent
      // instead of letting the mix bounce back with a generic error.
      if (NEUTRAL_INSPIRATION_VALUES.has(value)) return [value]
      const withoutNeutrals = current.filter(
        (entry) => !NEUTRAL_INSPIRATION_VALUES.has(entry),
      )
      if (withoutNeutrals.length >= question.maxSelections) return current
      return [...withoutNeutrals, value]
    })
  }

  return (
    <div className="mt-4 grid gap-3">
      {showLabel ? (
        <h3 className="text-base font-black text-textPrimary">{question.label}</h3>
      ) : null}
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
      <button
        type="button"
        disabled={busy || needsSelection}
        className={`${BUTTON_PRIMARY} justify-self-start`}
        onClick={() => onAnswer(question, selected)}
      >
        Next
      </button>
    </div>
  )
}
