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
  ConsultSessionLookupDTO,
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
        "requirement": "REQUIRED"
      },
      {
        "key": "hair_left",
        "title": "Left side",
        "instruction": "Turn the left side toward the camera in indirect daylight.",
        "requirement": "REQUIRED"
      },
      {
        "key": "hair_right",
        "title": "Right side",
        "instruction": "Turn the right side toward the camera in indirect daylight.",
        "requirement": "REQUIRED"
      },
      {
        "key": "hair_crown",
        "title": "Crown",
        "instruction": "Angle the crown toward the camera in indirect daylight.",
        "requirement": "REQUIRED"
      },
      {
        "key": "face_front",
        "title": "Face front",
        "instruction": "Face the camera straight on in indirect daylight with a relaxed, neutral expression.",
        "requirement": "REQUIRED"
      },
      {
        "key": "face_side",
        "title": "Profile",
        "instruction": "Turn fully to one side in indirect daylight.",
        "requirement": "REQUIRED"
      },
      {
        "key": "eyes_closeup",
        "title": "Eyes & brows",
        "instruction": "Fill the frame with both eyes and brows, eyes open, in indirect daylight.",
        "requirement": "REQUIRED"
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
