// lib/consult/analysisRunCopy.ts
//
// P4b: what the client reads while her plan is being built.
//
// Client-safe by construction — no `server-only`, no Prisma value import, no
// database. It takes the run DTO and returns strings, so the waiting screen is
// a pure function of the run and both the web flow and its tests read the same
// words.
//
// The stages are named for what the client can picture, not for what the code
// is doing: "reading your photos" is a storage fetch plus a verification pass,
// "understanding your reference" is the inspiration vision call, "building
// your plan" is the two analysis calls. She does not need the architecture;
// she needs to know it is moving and roughly how far along it is.
//
// The iOS app carries its own copy of these strings (ConsultAnalysisCopy.swift).
// They are duplicated across a repo boundary on purpose — there is no shared
// module — so a change here is a change there.

import type { ConsultAnalysisRunDTO } from '@/lib/dto/consult'

export type ConsultAnalysisRunProgress = {
  /** The line under the spinner. */
  headline: string
  /** A quieter second line, or null when the headline says enough. */
  detail: string | null
  /** 0..1, for a determinate bar. Coarse on purpose — see below. */
  fraction: number
}

/**
 * Deliberately coarse and monotonic.
 *
 * A bar that creeps and then jumps backwards reads as broken, and the honest
 * per-stage durations are wildly uneven (the direction call alone ranged 29s
 * to over 90s in measurement, against ~5s for the reference read). So each
 * stage claims a fixed slice, and the longest stage owns the longest one. The
 * bar never goes backwards because a stage never does.
 */
const STAGE_FRACTION: Readonly<Record<ConsultAnalysisRunDTO['stage'], number>> = {
  QUEUED: 0.05,
  READING_PHOTOS: 0.2,
  UNDERSTANDING_REFERENCE: 0.4,
  BUILDING_PLAN: 0.75,
  FINALIZING: 0.95,
  DONE: 1,
}

function photosPhrase(photoCount: number): string {
  if (photoCount <= 0) return 'your photos'
  return photoCount === 1 ? 'your photo' : `your ${photoCount} photos`
}

export function consultAnalysisRunProgress(
  run: ConsultAnalysisRunDTO,
): ConsultAnalysisRunProgress {
  if (run.status === 'COMPLETED') {
    return { headline: 'Your plan is ready.', detail: null, fraction: 1 }
  }
  if (run.status === 'FAILED') {
    return {
      headline: 'We couldn’t finish your plan.',
      detail:
        'Your photos and answers are still saved — you can try again from here.',
      fraction: STAGE_FRACTION[run.stage],
    }
  }

  const fraction = STAGE_FRACTION[run.stage]
  switch (run.stage) {
    case 'QUEUED':
      return {
        headline: 'Getting started…',
        detail: 'This usually takes a minute or two.',
        fraction,
      }
    case 'READING_PHOTOS':
      return {
        headline: `Reading ${photosPhrase(run.photoCount)}…`,
        detail: 'This usually takes a minute or two.',
        fraction,
      }
    case 'UNDERSTANDING_REFERENCE':
      return {
        headline: 'Understanding your reference…',
        detail: 'Looking at the picture you brought.',
        fraction,
      }
    case 'BUILDING_PLAN':
      return {
        headline: 'Building your plan…',
        detail: 'This is the longest part. Hang tight.',
        fraction,
      }
    case 'FINALIZING':
      return { headline: 'Almost there…', detail: null, fraction }
    case 'DONE':
      return { headline: 'Your plan is ready.', detail: null, fraction: 1 }
  }
}

/** Whether the client should still be polling this run. */
export function isConsultAnalysisRunLive(run: ConsultAnalysisRunDTO): boolean {
  return run.status === 'QUEUED' || run.status === 'RUNNING'
}

/** How often to poll a live run, in milliseconds. */
export const CONSULT_ANALYSIS_POLL_INTERVAL_MS = 5_000
