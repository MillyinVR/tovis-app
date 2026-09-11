// tests/e2e/utils/renderProConsultBriefMarkup.ts
//
// Renders the SHIPPING pro Brief component to static markup and prints it.
// Run out of process by tests/e2e/consult-pro-brief-top-line.spec.ts, because
// Playwright compiles every `.tsx` module it loads with its OWN JSX runtime
// (for component testing) and the result is not a React element —
// `renderToStaticMarkup` refuses it as "not a valid React child". `tsx` uses
// React's runtime and honours tsconfig paths, so the component renders here
// exactly as the server renders it.
//
// Usage: pnpm exec tsx tests/e2e/utils/renderProConsultBriefMarkup.ts '<top line>'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import ProConsultBrief from '@/app/pro/_components/consult/ProConsultBrief'
import type { ConsultClientResultsDTO, ConsultProBriefDTO } from '@/lib/dto/consult'

import { plan } from '../fixtures/consultLookBrief'
import profileResults from '../fixtures/consultProfileResults.json'

const topLine = process.argv[2]
if (!topLine) throw new Error('Pass the top line as the first argument.')

// The client-results fixture carries the same analysis material the pro Brief
// shows (client words, observations, profile, directions, flags); the Brief's
// own identity and the pro-only fields are set here.
const results = profileResults as ConsultClientResultsDTO
const brief: ConsultProBriefDTO = {
  consultId: 'consult_top_line',
  bookingId: 'booking_top_line',
  lookPostId: null,
  professionalId: 'pro_top_line',
  serviceCategoryId: results.serviceCategoryId,
  briefRevisionId: 'brief_top_line',
  briefRevision: 1,
  sourceAnalysisRevisionId: 'analysis_top_line',
  sourceAnalysisRevision: 1,
  intakeRevisionId: 'intake_top_line',
  inspiration: {
    revisionId: 'inspiration_top_line',
    source: 'EXTERNAL_UPLOAD',
    inspirationId: 'insp_top_line',
    lookPostId: null,
    mediaEndpoint: null,
    referenceNote: 'Use it as a reference, not a guarantee.',
    exactClientDetails: [],
    possibleProfessionalInterpretation: [],
    catalogGuidance: [],
  },
  clientIntake: results.clientIntake,
  aiObservations: results.aiObservations,
  profile: results.profile,
  styleDirections: results.styleDirections,
  safetyFlags: results.safetyFlags,
  achievabilityDirection: results.achievabilityDirection,
  recommendationDirections: results.recommendationDirections,
  lookPlan: plan,
  planVersion: 2,
  planChanges: [],
  feedback: null,
  proFollowUps: [],
  topLine,
  createdAt: '2026-09-11T00:00:00.000Z',
}

process.stdout.write(
  renderToStaticMarkup(createElement(ProConsultBrief, { brief, timeZone: 'America/Los_Angeles' })),
)
