// tests/e2e/fixtures/consultInspiration.ts
//
// Consult API responses for tests/e2e/consult-inspiration-image.spec.ts, which
// drives the REAL ClientConsultFlow in a real browser with the API stubbed.
//
// 🔴 Each constant is TYPED as its DTO on purpose. That is what stops a stub
// from drifting away from the server it stands in for: a DTO that gains or
// renames a field fails `npm run typecheck` here, in the same PR. The values
// are the same ones tovis-ios keeps in
// TovisKit/Tests/TovisKitTests/Fixtures/consultFlow.json (which the cross-repo
// guard validates against this repo's generated API schema) — but they are
// COPIED rather than read from that checkout, because the e2e runner has no
// tovis-ios beside it.

import type {
  ConsultCaptureStateDTO,
  ConsultInspirationStateDTO,
  ConsultPlanDiffEntryDTO,
  ConsultSessionLookupDTO,
  ConsultThreadDTO,
  ConsultThreadMessageDTO,
} from '@/lib/dto/consult'

export const CONSULT_FIXTURE_ID = 'consult_fixture_1'

/** MEDIA_READY: the stage where the inspiration questions run. */
export const consultLookup: ConsultSessionLookupDTO = {
  "id": "consult_fixture_1",
  "status": "MEDIA_READY",
  "bookingId": "booking_fixture_1",
  "professionalId": "cmq9p645v0002jp04fttoatlq",
  "serviceCategoryId": "category_hair_color_1",
  "createdAt": "2026-08-11T18:00:00.000Z"
}

/** The client uploaded her own reference photo. */
export const uploadSourceInspiration: ConsultInspirationStateDTO = {
  "consultId": "consult_fixture_1",
  "status": "MEDIA_READY",
  "schemaVersion": 1,
  "introduction": "An inspiration picture is optional. It can help you and your professional get visually on the same page.",
  "referenceNote": "Use it as a reference, not a guarantee or something that can be copied directly onto you.",
  "reflectionPrompt": "A complete look can include color, length, fullness, and styling. Take a moment to choose what actually stands out to you.",
  "source": {
    "inspirationId": "inspiration_fixture_1",
    "source": "EXTERNAL_UPLOAD",
    "lookPostId": null,
    "imageReadEndpoint": "/api/v1/client/consult/consult_fixture_1/inspiration/media",
    "imageAvailable": true,
    "useExpiresAt": "2026-08-12T18:00:00.000Z"
  },
  "progress": {
    "currentQuestion": {
      "key": "favorite_colors",
      "label": "Which color or colors in this picture are your favorite?",
      "helpText": null,
      "kind": "MULTI_SELECT",
      "options": [
        {
          "value": "lightest-pieces",
          "label": "The lightest pieces"
        },
        {
          "value": "darkest-pieces",
          "label": "The darkest pieces"
        },
        {
          "value": "warm-golden",
          "label": "The warm or golden colors"
        },
        {
          "value": "cool-smoky",
          "label": "The cool or smoky colors"
        },
        {
          "value": "copper-red",
          "label": "The copper or red colors"
        },
        {
          "value": "whole-color-mix",
          "label": "The whole mix of colors"
        },
        {
          "value": "not-sure",
          "label": "Not sure"
        }
      ],
      "minSelections": 1,
      "maxSelections": 4,
      "allowText": false
    },
    "answeredQuestionCount": 0,
    "specificDetailCount": 0,
    "requiredSpecificDetailCount": 3,
    "canComplete": false,
    "blocker": "QUESTIONS_REMAINING"
  },
  "latestReview": null
}

/**
 * Book-the-look: the consult is anchored to a Look and the inspiration was
 * SEEDED from it. The endpoint is the same per-consult media route the upload
 * source uses — that identity is the contract this suite exists to hold.
 */
export const lookSourceInspiration: ConsultInspirationStateDTO = {
  "consultId": "consult_fixture_1",
  "status": "MEDIA_READY",
  "schemaVersion": 1,
  "introduction": "An inspiration picture is optional. It can help you and your professional get visually on the same page.",
  "referenceNote": "Use it as a reference, not a guarantee or something that can be copied directly onto you.",
  "reflectionPrompt": "A complete look can include color, length, fullness, and styling. Take a moment to choose what actually stands out to you.",
  "source": {
    "inspirationId": "inspiration_fixture_look_1",
    "source": "PLATFORM_LOOK",
    "lookPostId": "look_fixture_1",
    "imageReadEndpoint": "/api/v1/client/consult/consult_fixture_1/inspiration/media",
    "imageAvailable": true,
    "useExpiresAt": null
  },
  "progress": {
    "currentQuestion": {
      "key": "favorite_colors",
      "label": "Which color or colors in this picture are your favorite?",
      "helpText": null,
      "kind": "MULTI_SELECT",
      "options": [
        {
          "value": "lightest-pieces",
          "label": "The lightest pieces"
        },
        {
          "value": "darkest-pieces",
          "label": "The darkest pieces"
        },
        {
          "value": "warm-golden",
          "label": "The warm or golden colors"
        },
        {
          "value": "cool-smoky",
          "label": "The cool or smoky colors"
        },
        {
          "value": "copper-red",
          "label": "The copper or red colors"
        },
        {
          "value": "whole-color-mix",
          "label": "The whole mix of colors"
        },
        {
          "value": "not-sure",
          "label": "Not sure"
        }
      ],
      "minSelections": 1,
      "maxSelections": 4,
      "allowText": false
    },
    "answeredQuestionCount": 0,
    "specificDetailCount": 0,
    "requiredSpecificDetailCount": 3,
    "canComplete": false,
    "blocker": "QUESTIONS_REMAINING"
  },
  "latestReview": null
}

export const captureState: ConsultCaptureStateDTO = {
  "consultId": "consult_fixture_1",
  "status": "ANALYSIS_PENDING",
  // P7a-1: this fixture is a consult already past the early stage (it is at
  // ANALYSIS_PENDING), so it holds no early photo. The stage's own coverage is
  // in tests/integration/consult-early-photo.test.ts.
  "earlyPhoto": null,
  "shotPack": {
    "id": "hair-color-daylight",
    "categorySlug": "hair-color",
    "version": 2,
    "schemaVersion": 1,
    "shots": [
      {
        "key": "hair_back",
        "title": "Hair back",
        "instruction": "Face away from the camera in indirect daylight.",
        "requirement": "REQUIRED",
        "framing": "FULL_VIEW"
      },
      {
        "key": "hair_left",
        "title": "Left side",
        "instruction": "Turn the left side toward the camera in indirect daylight.",
        "requirement": "REQUIRED",
        "framing": "FULL_VIEW"
      },
      {
        "key": "hair_right",
        "title": "Right side",
        "instruction": "Turn the right side toward the camera in indirect daylight.",
        "requirement": "REQUIRED",
        "framing": "FULL_VIEW"
      },
      {
        "key": "hair_crown",
        "title": "Crown",
        "instruction": "Angle the crown toward the camera in indirect daylight.",
        "requirement": "REQUIRED",
        "framing": "FULL_VIEW"
      },
      {
        "key": "face_front",
        "title": "Face front",
        "instruction": "Face the camera straight on in indirect daylight with a relaxed, neutral expression.",
        "requirement": "REQUIRED",
        "framing": "FULL_VIEW"
      },
      {
        "key": "face_side",
        "title": "Profile",
        "instruction": "Turn fully to one side in indirect daylight.",
        "requirement": "REQUIRED",
        "framing": "FULL_VIEW"
      },
      {
        "key": "eyes_closeup",
        "title": "Eyes & brows",
        "instruction": "Fill the frame with both eyes and brows, eyes open, in indirect daylight.",
        "requirement": "REQUIRED",
        "framing": "TIGHT_CROP"
      }
    ]
  },
  "slots": [
    {
      "shotKey": "hair_back",
      "state": "ACCEPTED",
      "captureId": "capture_back_2",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    },
    {
      "shotKey": "hair_left",
      "state": "ACCEPTED",
      "captureId": "capture_left_1",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    },
    {
      "shotKey": "hair_right",
      "state": "ACCEPTED",
      "captureId": "capture_right_1",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    },
    {
      "shotKey": "hair_crown",
      "state": "ACCEPTED",
      "captureId": "capture_crown_1",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    },
    {
      "shotKey": "face_front",
      "state": "ACCEPTED",
      "captureId": "capture_face_front_1",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    },
    {
      "shotKey": "face_side",
      "state": "ACCEPTED",
      "captureId": "capture_face_side_1",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    },
    {
      "shotKey": "eyes_closeup",
      "state": "ACCEPTED",
      "captureId": "capture_eyes_closeup_1",
      "qualityReasonCode": "PASS",
      "qualityWarningCode": null,
      "retakeTip": null,
      "rawExpiresAt": "2026-08-12T18:00:00.000Z",
      "purgedAt": null
    }
  ],
  "chartCopy": {
    "optIn": true,
    "decidedAt": "2026-08-12T17:00:00.000Z"
  }
}

// ── P5a — the THREAD the page actually reads ────────────────────────────────
//
// The page makes ONE call now (`…/thread`) instead of five per-stage calls, so
// these compose the same stage states above into the message list the server
// projects. Typed as the DTO for the same reason everything else here is: a
// projection that gains or renames a field fails typecheck in this file.

/** The photo requests, derived from the same shot pack + slots as the stage state. */
function threadPhotoMessages(
  capture: ConsultCaptureStateDTO,
  overrides: Partial<Record<string, ConsultCaptureStateDTO['slots'][number]['state']>> = {},
): ConsultThreadMessageDTO[] {
  const slots = new Map(capture.slots.map((slot) => [slot.shotKey, slot]))
  let firstOpen = true
  return capture.shotPack.shots.map((shot) => {
    const base = slots.get(shot.key)!
    const state = overrides[shot.key] ?? base.state
    const slot = { ...base, state }
    const settled = state === 'ACCEPTED'
    const open = !settled && firstOpen
    if (open) firstOpen = false
    return {
      kind: 'PHOTO_REQUEST',
      id: `photo:${shot.key}`,
      author: 'APP',
      state: settled ? 'DONE' : open ? 'OPEN' : 'BLOCKED',
      shot,
      shotPackVersion: capture.shotPack.version,
      schemaVersion: capture.shotPack.schemaVersion,
      slot,
    }
  })
}

/**
 * P5b — the same inspiration state, with the vision read not yet done.
 *
 * `analysisReady: false` is what makes the page ask for the reading; ABSENT
 * (every other fixture here) means a server with no read stage, which the page
 * must leave alone.
 */
/**
 * P5c — the same consult on CONTRACT v2, served the general-service pack.
 *
 * Derived from the upload fixture rather than re-typed, so only the things
 * that actually differ between the contracts appear here: the schema version
 * the client echoes, the reflection prompt (no colour/length/fullness for a
 * service that is not hair), the pack's own first question, and a required
 * detail count of ZERO — v2 has no gate.
 *
 * Values are lifted from lib/consult/inspiration/packs/generalService.ts. It is
 * a fixture, so it is a copy by construction; the registry test is what holds
 * the pack itself honest.
 */
export const generalServiceInspiration: ConsultInspirationStateDTO = {
  ...uploadSourceInspiration,
  schemaVersion: 2,
  reflectionPrompt:
    'A picture can be about several things at once. Take a moment to choose what actually stands out to you.',
  progress: {
    ...uploadSourceInspiration.progress,
    currentQuestion: {
      key: 'favorite_details',
      label: 'What do you like most about this picture?',
      helpText: null,
      kind: 'MULTI_SELECT',
      options: [
        { value: 'the-color', label: 'The color' },
        { value: 'the-shape', label: 'The shape' },
        { value: 'the-length', label: 'The length' },
        { value: 'the-finish', label: 'The finish' },
        { value: 'the-overall-look', label: 'The overall look' },
        { value: 'not-sure', label: 'Not sure' },
      ],
      minSelections: 1,
      maxSelections: 4,
      // 🔴 v2 records no free text at all. The card must offer no way to type.
      allowText: false,
    },
    answeredQuestionCount: 0,
    specificDetailCount: 0,
    requiredSpecificDetailCount: 0,
    canComplete: false,
    blocker: 'QUESTIONS_REMAINING',
  },
}

/**
 * P5d — the same consult with a READING behind it, so the client gets CARDS.
 *
 * The reading is a light blonde: a level 6 base melting to a level 9, cool,
 * babylights through the mids and ends. The regions are in two different parts
 * of the frame on purpose — the colour attributes low and central, the
 * arrangement attributes high and wide — because "the coarse crops visibly
 * correspond to colour vs shape" is a claim about geometry, and a fixture that
 * used one box everywhere could not prove it in a browser.
 *
 * Values lifted from lib/consult/inspiration/cardQuestions.ts and the brand's
 * card copy table; the registry's own test is what holds those honest.
 */
export const cardInspiration: ConsultInspirationStateDTO = {
  ...uploadSourceInspiration,
  schemaVersion: 2,
  progress: {
    ...uploadSourceInspiration.progress,
    currentQuestion: null,
    nextPrepQuestionKey: 'attr_tone',
    answeredQuestionCount: 3,
    specificDetailCount: 2,
    requiredSpecificDetailCount: 0,
    canComplete: true,
    blocker: null,
  },
  cards: [
    {
      questionKey: 'spark_focus',
      tier: 'COARSE',
      attribute: null,
      attributeValue: null,
      name: null,
      region: null,
      presentation: 'CROP',
      optionRegions: [
        { value: 'the-color', label: 'The color', region: { x: 0.3, y: 0.5, w: 0.4, h: 0.4 } },
        { value: 'the-shape', label: 'The shape of it', region: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 } },
        { value: 'the-whole-thing', label: 'The whole thing', region: null },
        { value: 'not-sure', label: 'Not sure', region: null },
      ],
      question: {
        key: 'spark_focus',
        label: 'What made you stop scrolling?',
        helpText: null,
        kind: 'SINGLE_SELECT',
        options: [
          { value: 'the-color', label: 'The color' },
          { value: 'the-shape', label: 'The shape of it' },
          { value: 'the-whole-thing', label: 'The whole thing' },
          { value: 'not-sure', label: 'Not sure' },
        ],
        minSelections: 1,
        maxSelections: 1,
        allowText: false,
      },
      selectedValues: [],
    },
    {
      questionKey: 'attr_tone',
      tier: 'PREP',
      attribute: 'tone',
      attributeValue: 'COOL',
      name: 'This is the cooler, silvery cast in it — some people call it ash.',
      region: { x: 0.32, y: 0.5, w: 0.36, h: 0.25 },
      presentation: 'CROP',
      optionRegions: [],
      question: {
        key: 'attr_tone',
        label: 'Is this part of what you like?',
        helpText: null,
        kind: 'SINGLE_SELECT',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'not-this', label: 'Not this' },
          { value: 'not-sure', label: 'Not sure' },
        ],
        minSelections: 1,
        maxSelections: 1,
        allowText: false,
      },
      selectedValues: [],
    },
  ],
}

/**
 * P5g — the "Tap what you love" move, as the server projects it for the blonde
 * reference: the whole photograph with every readable attribute drawn on it.
 *
 * The regions are deliberately in DIFFERENT parts of the frame, because "each
 * region points at the part of the picture it was read from" is a claim about
 * pixels, and a fixture that used one box everywhere could not prove it.
 */
export const regionPickerInspiration: ConsultInspirationStateDTO = {
  ...cardInspiration,
  progress: {
    ...cardInspiration.progress,
    nextPrepQuestionKey: 'love_regions',
  },
  cards: [
    ...(cardInspiration.cards ?? []).filter((card) => card.tier === 'COARSE'),
    {
      questionKey: 'love_regions',
      tier: 'PREP',
      attribute: null,
      attributeValue: null,
      name: null,
      // 🔴 Null: the boxes are measured against the WHOLE photograph, so a crop
      // here would move every one of them.
      region: null,
      presentation: 'REGION_PICKER',
      optionRegions: [
        {
          value: 'base-level',
          label: 'light brown',
          region: { x: 0.35, y: 0.05, w: 0.3, h: 0.15 },
        },
        {
          value: 'lightest-level',
          label: 'light blonde',
          region: { x: 0.3, y: 0.6, w: 0.4, h: 0.3 },
        },
        {
          value: 'tone',
          label: 'cool, silvery cast',
          region: { x: 0.32, y: 0.42, w: 0.36, h: 0.16 },
        },
        { value: 'not-sure', label: 'Not sure yet', region: null },
      ],
      question: {
        key: 'love_regions',
        label: 'Tap what you love.',
        helpText: null,
        kind: 'MULTI_SELECT',
        options: [
          { value: 'base-level', label: 'light brown' },
          { value: 'lightest-level', label: 'light blonde' },
          { value: 'tone', label: 'cool, silvery cast' },
          { value: 'not-sure', label: 'Not sure yet' },
        ],
        minSelections: 1,
        maxSelections: 3,
        allowText: false,
      },
      selectedValues: [],
    },
  ],
}

/** P5g — the follow-up messages, generated and fallback. */
export function threadFollowUpMessages(): ConsultThreadMessageDTO[] {
  return [
    {
      kind: 'TEXT',
      id: 'follow-up-intro',
      author: 'APP',
      state: 'DONE',
      text: 'A couple of things I want to check with you, now that I’ve had a proper look.',
    },
    {
      kind: 'FOLLOW_UP',
      id: 'follow-up:1:prior_lightening',
      author: 'APP',
      state: 'OPEN',
      text: 'You’re at a light brown now and you loved the ash — that’s usually two visits. When was your hair last lightened?',
      questionKey: 'prior_lightening',
      options: [
        { value: 'never', label: 'Never' },
        { value: 'within-3-months', label: 'In the last few months' },
        { value: 'not-sure', label: 'I don’t remember' },
      ],
      selectedValues: [],
      fallback: false,
      round: 1,
    },
    {
      kind: 'TEXT',
      id: 'follow-up-fallback:2',
      author: 'APP',
      state: 'DONE',
      text: 'I couldn’t think of the next question just now — so here are the essentials, the ones Susie needs either way.',
    },
    {
      kind: 'FOLLOW_UP',
      id: 'follow-up:2:henna_plant_dye_history',
      author: 'APP',
      state: 'BLOCKED',
      text: 'When did you last use henna or another plant-based hair dye?',
      questionKey: 'henna_plant_dye_history',
      options: [
        { value: 'never', label: 'Never' },
        { value: 'within-6-months', label: 'Within 6 months' },
      ],
      selectedValues: [],
      fallback: true,
      round: 2,
    },
  ]
}

export function withAnalysisReady(
  inspiration: ConsultInspirationStateDTO,
  analysisReady: boolean,
): ConsultInspirationStateDTO {
  if (!inspiration.source) return inspiration
  return {
    ...inspiration,
    source: { ...inspiration.source, analysisReady },
  }
}

/**
 * P7a-1 — the early photo message, in its own position: after the coarse cards
 * and BEFORE the intake and the guided pack. A member of no pack, so it is
 * built here rather than by `threadPhotoMessages`.
 */
function threadEarlyPhotoMessage(
  early: ConsultCaptureStateDTO['earlyPhoto'],
): ConsultThreadMessageDTO {
  const settled = early?.state === 'ACCEPTED'
  return {
    kind: 'PHOTO_REQUEST',
    id: 'photo:early_photo',
    author: 'APP',
    // Never BLOCKED: there is nothing ahead of it to wait for.
    state: settled ? 'DONE' : 'OPEN',
    shot: {
      key: 'early_photo',
      title: 'What you have right now',
      instruction:
        'One photo of you as you are — camera or camera roll, whatever light you are in. It does not need to be a good photo.',
      requirement: 'REQUIRED',
      framing: 'FULL_VIEW',
    },
    shotPackVersion: 1,
    schemaVersion: 1,
    slot: early ?? {
      shotKey: 'early_photo',
      state: 'EMPTY',
      captureId: null,
      qualityReasonCode: null,
      qualityWarningCode: null,
      retakeTip: null,
      rawExpiresAt: null,
      purgedAt: null,
    },
  }
}

/** P7a-3 — the plan card and one PLAN_UPDATE bubble per version after the first. */
function planMessages(plan: {
  version: number
  updatePending?: boolean
  updates?: Array<{ version: number; changes: ConsultPlanDiffEntryDTO[] }>
}): ConsultThreadMessageDTO[] {
  const updating = plan.updatePending === true
  return [
    {
      kind: 'PLAN',
      id: 'plan',
      author: 'APP',
      state: 'DONE',
      text: updating
        ? 'You changed something, so I’m having another look. One minute.'
        : 'Here’s where you’re starting from and what it would take. These are things to talk through with Susie, not promises.',
      run: null,
      results: null,
      awaitingStart: false,
      schemaVersion: 4,
      promptVersion: 'service-analysis-v5',
      planVersion: plan.version,
      updatePending: updating,
    },
    ...(plan.updates ?? []).map(
      (update): ConsultThreadMessageDTO => ({
        kind: 'PLAN_UPDATE',
        id: `plan-update:rev_${update.version}`,
        author: 'APP',
        state: 'DONE',
        text:
          update.changes.length > 0
            ? 'Your plan moved. Here’s what changed:'
            : 'I looked again with what you added — the plan still holds. Nothing to change.',
        planVersion: update.version,
        previousPlanVersion: update.version - 1,
        changes: update.changes,
        createdAt: '2026-09-06T10:14:00.000Z',
      }),
    ),
  ]
}

export function threadFixture(args: {
  inspiration: ConsultInspirationStateDTO
  /** Force particular slots to a state, e.g. the selfie not yet sent. */
  slotOverrides?: Partial<Record<string, ConsultCaptureStateDTO['slots'][number]['state']>>
  bookEnabled?: boolean
  /** P7a-1: the early photo's slot, or null for "not taken yet". */
  earlyPhoto?: ConsultCaptureStateDTO['earlyPhoto']
  status?: ConsultThreadDTO['status']
  /** P5g — append the adaptive follow-up messages after the plan. */
  followUps?: boolean
  /**
   * P7a-3: a finished, VERSIONED plan.
   *
   * `changes` empty is a real case with its own copy — a rerun that reached the
   * same answer — so it is representable here rather than being conflated with
   * "no bubble".
   */
  plan?: {
    version: number
    updatePending?: boolean
    updates?: Array<{
      version: number
      changes: ConsultPlanDiffEntryDTO[]
    }>
  }
}): ConsultThreadDTO {
  const photos = threadPhotoMessages(captureState, args.slotOverrides)
  const cards = args.inspiration.cards ?? []
  // P5d — one message per card, exactly as lib/consult/thread.ts projects them.
  const cardMessages: ConsultThreadMessageDTO[] = cards.map((card, index) => ({
    kind: 'INSPIRATION',
    id: `inspiration:${card.questionKey}`,
    author: 'APP',
    state: card.selectedValues.length > 0 ? 'DONE' : index === 0 ? 'OPEN' : 'BLOCKED',
    // 🔴 A card says its piece on the card, so no bubble above it.
    text: null,
    sourceDecisionRequired: false,
    source: args.inspiration.source,
    question: card.question,
    card,
    answeredQuestionCount: args.inspiration.progress.answeredQuestionCount,
    specificDetailCount: args.inspiration.progress.specificDetailCount,
    requiredSpecificDetailCount: args.inspiration.progress.requiredSpecificDetailCount,
    schemaVersion: args.inspiration.schemaVersion,
  }))
  const messages: ConsultThreadMessageDTO[] = [
    {
      kind: 'TEXT',
      id: 'opening',
      author: 'APP',
      state: 'DONE',
      text: 'Love this one. Let’s work out what it would take on you.',
    },
    {
      kind: 'INSPIRATION',
      id: 'inspiration',
      author: 'APP',
      // A card consult's step message is the bubble and the reference; the
      // OPEN step is the card.
      state: cards.length > 0 ? 'DONE' : 'OPEN',
      text: 'Now tell me what you like about it — tap what catches your eye.',
      sourceDecisionRequired: false,
      source: args.inspiration.source,
      question: cards.length > 0 ? null : args.inspiration.progress.currentQuestion,
      card: null,
      answeredQuestionCount: args.inspiration.progress.answeredQuestionCount,
      specificDetailCount: args.inspiration.progress.specificDetailCount,
      requiredSpecificDetailCount:
        args.inspiration.progress.requiredSpecificDetailCount,
      schemaVersion: args.inspiration.schemaVersion,
    },
    ...cardMessages,
    // P7a-1: the early photo sits HERE — after the coarse cards, before the
    // intake and the guided pack. This is the photo that unlocks the booking.
    threadEarlyPhotoMessage(args.earlyPhoto ?? null),
    {
      kind: 'TEXT',
      id: 'capture-intro',
      author: 'APP',
      state: 'DONE',
      text: 'Now a few of you, in daylight if you can.',
    },
    ...photos,
    // P7a-3 — the finished plan, and the version bubbles after it.
    //
    // Appended only when the caller asks for a plan, so every existing spec
    // keeps the thread it had: those describe a consult that has not run yet.
    ...(args.plan ? planMessages(args.plan) : []),
    ...(args.followUps ? threadFollowUpMessages() : []),
  ]

  return {
    consultId: CONSULT_FIXTURE_ID,
    status: args.status ?? 'MEDIA_READY',
    professionalId: 'cmq9p645v0002jp04fttoatlq',
    professionalDisplayName: 'Susie',
    nextOpenMessageId:
      messages.find((message) => message.state === 'OPEN')?.id ?? null,
    messages,
    chartCopy: captureState.chartCopy,
    book: {
      enabled: args.bookEnabled ?? true,
      reason: args.bookEnabled === false ? 'SELFIE_REQUIRED' : null,
      lookPostId: 'look_fixture_1',
      serviceId: 'service_fixture_1',
      lookMediaId: 'media_fixture_1',
    },
  }
}
