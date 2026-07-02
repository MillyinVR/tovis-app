// lib/pro/cameraVision.ts
//
// Claude vision for the native AI-photographer camera (Phase D). Two calls:
//
//  - enhanceReferenceLook — a picked reference photo → the direction on-device
//    geometry can't measure (expression, head angle, hand styling, light
//    direction) as (a) extra pose rules in the camera's fixed vocabulary and
//    (b) plain direction lines the coach speaks/shows step-by-step.
//  - critiqueSessionSet — the captured before/after set → a photographer's
//    review: what's strong, what to retake and why, what's portfolio-worthy.
//
// The Anthropic API key lives server-side only. Images are analyzed in-flight
// and never persisted — no DB writes, no storage, and image bytes are never
// logged. Callers (the /pro/camera/* routes) enforce auth + the daily cap.

import Anthropic from '@anthropic-ai/sdk'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

import {
  POSE_RULE_KINDS,
  type PoseRuleKind,
  type ShotPackPoseRule,
} from './cameraShotPacks'

// ── wire types ──────────────────────────────────────────────────────────────

/** Image media types Claude vision accepts (minus GIF — never a camera still). */
export const CAMERA_VISION_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type CameraVisionMediaType = (typeof CAMERA_VISION_MEDIA_TYPES)[number]

export type CameraVisionImage = {
  base64: string
  mediaType: CameraVisionMediaType
}

export type LookBrief = {
  /** One-line read of the reference's vibe, shown above the direction lines. */
  summary: string
  /** Extra pose rules in the camera's measurable vocabulary. */
  poseRules: ShotPackPoseRule[]
  /** Spoken/shown direction lines, in coaching order. */
  directionLines: string[]
}

export type SetCritiquePhase = 'BEFORE' | 'AFTER'

export type SetCritiquePhotoInput = {
  /** The caller's identifier for the photo (media asset id); echoed back. */
  id: string
  phase: SetCritiquePhase
  image: CameraVisionImage
}

export const SET_CRITIQUE_VERDICTS = ['portfolio', 'keep', 'retake'] as const

export type SetCritiqueVerdict = (typeof SET_CRITIQUE_VERDICTS)[number]

export type SetCritiquePhotoNote = {
  id: string
  verdict: SetCritiqueVerdict
  note: string
  retakeTip: string | null
}

export type SetCritique = {
  overall: string
  strengths: string[]
  photos: SetCritiquePhotoNote[]
}

// ── payload limits (Vercel's request-body cap is 4.5 MB — stay well under) ──

export const LOOK_IMAGE_MAX_BASE64_CHARS = 4_000_000
export const CRITIQUE_MIN_PHOTOS = 1
export const CRITIQUE_MAX_PHOTOS = 10
export const CRITIQUE_PHOTO_MAX_BASE64_CHARS = 1_200_000
export const CRITIQUE_TOTAL_MAX_BASE64_CHARS = 3_900_000

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export type ParsedCameraVisionImage =
  | { ok: true; image: CameraVisionImage }
  | { ok: false; error: string }

function pickMediaType(value: unknown): CameraVisionMediaType | null {
  const raw = pickString(value)
  if (!raw) return null
  return CAMERA_VISION_MEDIA_TYPES.find((type) => type === raw) ?? null
}

/** Validate a `{ base64, mediaType }` payload without ever logging its bytes. */
export function parseCameraVisionImage(
  value: unknown,
  maxBase64Chars: number,
): ParsedCameraVisionImage {
  if (!isRecord(value)) {
    return { ok: false, error: 'Missing image.' }
  }

  const mediaType = pickMediaType(value.mediaType)
  if (!mediaType) {
    return { ok: false, error: 'Unsupported image mediaType.' }
  }

  const base64 = typeof value.base64 === 'string' ? value.base64.trim() : ''
  if (!base64) {
    return { ok: false, error: 'Missing image data.' }
  }
  if (base64.length > maxBase64Chars) {
    return { ok: false, error: 'Image is too large.' }
  }
  if (!BASE64_PATTERN.test(base64)) {
    return { ok: false, error: 'Image data is not valid base64.' }
  }

  return { ok: true, image: { base64, mediaType } }
}

// ── errors ──────────────────────────────────────────────────────────────────

export type CameraVisionErrorKind = 'unavailable' | 'refused' | 'bad_output'

export class CameraVisionError extends Error {
  readonly kind: CameraVisionErrorKind

  constructor(kind: CameraVisionErrorKind, message: string) {
    super(message)
    this.name = 'CameraVisionError'
    this.kind = kind
  }
}

// ── Anthropic client ────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-opus-4-8'

/** Leave headroom under the routes' maxDuration (60 s) for parse + response. */
const REQUEST_TIMEOUT_MS = 50_000

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (cachedClient === null) {
    cachedClient = new Anthropic({
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
      maxRetries: 1,
    })
  }
  return cachedClient
}

export function resetCameraVisionClientForTests(): void {
  cachedClient = null
}

function visionModel(): string {
  return readOptionalEnv('CAMERA_VISION_MODEL') ?? DEFAULT_MODEL
}

async function runStructured(args: {
  system: string
  content: Anthropic.ContentBlockParam[]
  schema: Record<string, unknown>
  maxTokens: number
}): Promise<unknown> {
  let message: Anthropic.Message

  try {
    message = await getClient().messages.create(
      {
        model: visionModel(),
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: 'user', content: args.content }],
        output_config: {
          format: { type: 'json_schema', schema: args.schema },
        },
      },
      { timeout: REQUEST_TIMEOUT_MS },
    )
  } catch (error) {
    throw new CameraVisionError(
      'unavailable',
      error instanceof Error ? error.message : 'Claude request failed.',
    )
  }

  if (message.stop_reason === 'refusal') {
    throw new CameraVisionError(
      'refused',
      'The model declined to analyze this image.',
    )
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  if (!text) {
    throw new CameraVisionError('bad_output', 'Empty model response.')
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new CameraVisionError('bad_output', 'Model returned non-JSON output.')
  }
}

function imageBlock(image: CameraVisionImage): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.base64,
    },
  }
}

// ── shared sanitizers ───────────────────────────────────────────────────────

function cleanLine(value: unknown, maxChars: number): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

function cleanLines(
  value: unknown,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value)) return []

  const lines: string[] = []
  for (const item of value) {
    const line = cleanLine(item, maxChars)
    if (line) lines.push(line)
    if (lines.length >= maxItems) break
  }
  return lines
}

// ── enhanceReferenceLook ────────────────────────────────────────────────────

/** Params the pose-rule evaluators read, per kind — mirrored in the schema so
 * structured output can stay `additionalProperties: false` throughout. */
const POSE_RULE_PARAM_KEYS = [
  'maxFaceHeights',
  'maxFaceWidths',
  'minDegrees',
  'maxDegrees',
] as const

const LOOK_BRIEF_MAX_POSE_RULES = 4
const LOOK_BRIEF_MAX_DIRECTION_LINES = 6

const LOOK_BRIEF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'poseRules', 'directionLines'],
  properties: {
    summary: {
      type: 'string',
      description: "The look's vibe in one short line (max 90 characters).",
    },
    poseRules: {
      type: 'array',
      maxItems: LOOK_BRIEF_MAX_POSE_RULES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'tip'],
        properties: {
          kind: { type: 'string', enum: [...POSE_RULE_KINDS] },
          params: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(
              POSE_RULE_PARAM_KEYS.map((key) => [key, { type: 'number' }]),
            ),
          },
          tip: {
            type: 'string',
            description:
              'The words to say to get the subject into the pose (max 80 characters).',
          },
        },
      },
    },
    directionLines: {
      type: 'array',
      minItems: 3,
      maxItems: LOOK_BRIEF_MAX_DIRECTION_LINES,
      items: { type: 'string' },
    },
  },
}

const LOOK_BRIEF_SYSTEM =
  'You are an elite beauty-industry photographer and creative director. ' +
  'A beauty professional picked a reference photo (often a screenshot of a ' +
  'viral post) and wants to recreate its look with their client, live in a ' +
  'salon. The camera app has already measured the photo’s geometry ' +
  'on-device; you add ONLY what geometry cannot measure: expression and ' +
  'mood, head angle and tilt, hand styling, where the light comes from, and ' +
  'the styling details that sell the shot. Keep every line short, concrete, ' +
  'and speakable — the app reads them aloud to the pro while they shoot.'

function lookBriefInstructions(args: {
  serviceName: string | null
  measuredSummary: string | null
}): string {
  const context: string[] = []
  if (args.serviceName) {
    context.push(`The appointment’s service: ${args.serviceName}.`)
  }
  if (args.measuredSummary) {
    context.push(
      `Already measured on-device (do NOT repeat or contradict): ${args.measuredSummary}`,
    )
  }

  return [
    'Analyze the reference photo above.',
    ...context,
    '',
    'Return:',
    '- summary: the look’s vibe in one short line (max 90 characters).',
    '- poseRules: 0–4 rules, ONLY where they add posing the measured geometry missed. Vocabulary (kind → params):',
    '  - handNearFace → maxFaceHeights: a wrist within N face-heights of the face center',
    '  - bothHandsVisible → (no params): both wrists in frame',
    '  - shouldersTilted → minDegrees: shoulder line at least N degrees off level',
    '  - shouldersLevel → maxDegrees: shoulder line within N degrees of level',
    '  - faceNearShoulder → maxFaceWidths: face center within N face-widths of a shoulder',
    '  Each rule’s tip = the words to say to get the subject into it (max 80 characters).',
    '- directionLines: 3–6 short direction lines in coaching order (expression → head → hands → light).',
    '  Refer to the client as "them/their", e.g. "Turn their face toward the window light". Max 90 characters each.',
  ].join('\n')
}

function sanitizePoseRules(value: unknown): ShotPackPoseRule[] {
  if (!Array.isArray(value)) return []

  const rules: ShotPackPoseRule[] = []
  for (const item of value) {
    if (!isRecord(item)) continue

    const rawKind = pickString(item.kind)
    const kind: PoseRuleKind | undefined = POSE_RULE_KINDS.find(
      (known) => known === rawKind,
    )
    if (!kind) continue

    const tip = cleanLine(item.tip, 120)
    if (!tip) continue

    let params: Record<string, number> | undefined
    if (isRecord(item.params)) {
      const entries: [string, number][] = []
      for (const key of POSE_RULE_PARAM_KEYS) {
        const raw = item.params[key]
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          entries.push([key, raw])
        }
      }
      if (entries.length > 0) params = Object.fromEntries(entries)
    }

    rules.push(params ? { kind, params, tip } : { kind, tip })
    if (rules.length >= LOOK_BRIEF_MAX_POSE_RULES) break
  }
  return rules
}

function sanitizeLookBrief(raw: unknown): LookBrief {
  if (!isRecord(raw)) {
    throw new CameraVisionError('bad_output', 'Malformed look brief.')
  }

  const directionLines = cleanLines(
    raw.directionLines,
    LOOK_BRIEF_MAX_DIRECTION_LINES,
    140,
  )
  if (directionLines.length === 0) {
    throw new CameraVisionError('bad_output', 'Look brief had no direction.')
  }

  return {
    summary: cleanLine(raw.summary, 140),
    poseRules: sanitizePoseRules(raw.poseRules),
    directionLines,
  }
}

/** Send a reference photo to Claude vision and get back the richer brief. */
export async function enhanceReferenceLook(input: {
  image: CameraVisionImage
  serviceName?: string | null
  measuredSummary?: string | null
}): Promise<LookBrief> {
  const raw = await runStructured({
    system: LOOK_BRIEF_SYSTEM,
    content: [
      imageBlock(input.image),
      {
        type: 'text',
        text: lookBriefInstructions({
          serviceName: input.serviceName ?? null,
          measuredSummary: input.measuredSummary ?? null,
        }),
      },
    ],
    schema: LOOK_BRIEF_SCHEMA,
    maxTokens: 3000,
  })

  return sanitizeLookBrief(raw)
}

// ── critiqueSessionSet ──────────────────────────────────────────────────────

const CRITIQUE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'strengths', 'photos'],
  properties: {
    overall: {
      type: 'string',
      description:
        'The set in at most 2 sentences: what to publish, what to reshoot.',
    },
    strengths: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string' },
    },
    photos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'note', 'retakeTip'],
        properties: {
          index: {
            type: 'integer',
            minimum: 1,
            description: 'The 1-based photo number from the labels above.',
          },
          verdict: { type: 'string', enum: [...SET_CRITIQUE_VERDICTS] },
          note: {
            type: 'string',
            description:
              'The photographer’s read on this photo (max 140 characters).',
          },
          retakeTip: {
            type: 'string',
            description:
              'For retakes only: the concrete fix in shooting terms (max 120 characters). Empty string otherwise.',
          },
        },
      },
    },
  },
}

const CRITIQUE_SYSTEM =
  'You are a beauty-industry photographer reviewing a professional’s ' +
  'session photo set for social and portfolio use. Be direct and specific ' +
  '— the pro is deciding right now, chair-side, what to publish and ' +
  'what to reshoot while the client is still in the room.'

function critiqueInstructions(args: {
  photoCount: number
  serviceName: string | null
}): string {
  const service = args.serviceName ? `a ${args.serviceName}` : 'a beauty'

  return [
    `The ${args.photoCount} photos above are the before/after set of ${service} appointment.`,
    '',
    'For EVERY photo return:',
    '- index: its 1-based number from the labels.',
    "- verdict: 'portfolio' (hero shot — feed/portfolio worthy), 'keep' (solid documentation, not a hero), or 'retake' (weak but fixable right now).",
    '- note: your read on that photo — name the decisive factor (max 140 characters).',
    "- retakeTip: for retakes only, the concrete fix in shooting terms — angle, light, focus, framing (max 120 characters). Empty string otherwise.",
    '',
    'Judge: sharpness on the subject, exposure and light direction, color, framing/crop, background, pose/expression — and whether AFTER shots actually showcase the finished work.',
    'Also return strengths (2–4 things this set does well) and overall (at most 2 sentences: what to publish, what to reshoot).',
  ].join('\n')
}

function sanitizeCritique(
  raw: unknown,
  photos: SetCritiquePhotoInput[],
): SetCritique {
  if (!isRecord(raw)) {
    throw new CameraVisionError('bad_output', 'Malformed critique.')
  }

  const notesById = new Map<string, SetCritiquePhotoNote>()
  if (Array.isArray(raw.photos)) {
    for (const item of raw.photos) {
      if (!isRecord(item)) continue

      const index = item.index
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 1 ||
        index > photos.length
      ) {
        continue
      }

      const photo = photos[index - 1]
      if (!photo) continue

      const id = photo.id
      if (notesById.has(id)) continue

      const rawVerdict = pickString(item.verdict)
      const verdict = SET_CRITIQUE_VERDICTS.find(
        (known) => known === rawVerdict,
      )
      if (!verdict) continue

      const retakeTip = cleanLine(item.retakeTip, 160)
      notesById.set(id, {
        id,
        verdict,
        note: cleanLine(item.note, 200),
        retakeTip: verdict === 'retake' && retakeTip ? retakeTip : null,
      })
    }
  }

  const orderedNotes = photos
    .map((photo) => notesById.get(photo.id))
    .filter((note): note is SetCritiquePhotoNote => note !== undefined)

  if (orderedNotes.length === 0) {
    throw new CameraVisionError('bad_output', 'Critique had no photo notes.')
  }

  return {
    overall: cleanLine(raw.overall, 400),
    strengths: cleanLines(raw.strengths, 4, 160),
    photos: orderedNotes,
  }
}

/** Send the captured before/after set to Claude for a photographer's review. */
export async function critiqueSessionSet(input: {
  photos: SetCritiquePhotoInput[]
  serviceName?: string | null
}): Promise<SetCritique> {
  const content: Anthropic.ContentBlockParam[] = []
  input.photos.forEach((photo, i) => {
    content.push({ type: 'text', text: `Photo ${i + 1} — ${photo.phase}` })
    content.push(imageBlock(photo.image))
  })
  content.push({
    type: 'text',
    text: critiqueInstructions({
      photoCount: input.photos.length,
      serviceName: input.serviceName ?? null,
    }),
  })

  const raw = await runStructured({
    system: CRITIQUE_SYSTEM,
    content,
    schema: CRITIQUE_SCHEMA,
    maxTokens: 4000,
  })

  return sanitizeCritique(raw, input.photos)
}
