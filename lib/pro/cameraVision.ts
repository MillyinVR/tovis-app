// lib/pro/cameraVision.ts
//
// Claude vision for the native AI-photographer camera (Phase D). Two calls:
//
//  - enhanceReferenceLook — a picked reference photo → the direction on-device
//    geometry can't measure (expression, head angle, hand styling, light
//    direction) as (a) extra pose rules in the camera's fixed vocabulary and
//    (b) direction lines bound to coach states, so the line spoken is chosen
//    by what the lens sees now instead of played in sequence.
//  - critiqueSessionSet — the captured before/after set → a photographer's
//    review: what's strong, what to retake and why, what's portfolio-worthy.
//    Each read runs strength → the one change → what that change buys, so it
//    lands like someone standing at the chair rather than a report card. The
//    strength has to name something visible in the frame, and a photo with no
//    strength leads with the problem instead — an invented one is how a pro
//    ends up publishing a bad photo.
//
// The Anthropic API key lives server-side only. Images are analyzed in-flight
// and never persisted — no DB writes, no storage, and image bytes are never
// logged. Callers (the /pro/camera/* routes) enforce auth + the daily cap.

import Anthropic from '@anthropic-ai/sdk'

import { readOptionalEnv, requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

import {
  DIRECTION_TRIGGER_KINDS,
  POSE_RULE_KINDS,
  type DirectionTriggerKind,
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

/** One direction line bound to the coach state that should speak it. */
export type LookBriefDirection = {
  trigger: DirectionTriggerKind
  line: string
}

export type LookBrief = {
  /** One-line read of the reference's vibe, shown above the direction lines. */
  summary: string
  /** Extra pose rules in the camera's measurable vocabulary. */
  poseRules: ShotPackPoseRule[]
  /** Direction lines keyed by the coach state that triggers them, in canonical
   * coaching order (DIRECTION_TRIGGER_KINDS declaration order). A build that
   * understands triggers speaks the line matching what the lens sees NOW rather
   * than working down a script. At most one line per trigger. When no line
   * carries the `opening` trigger the step falls back to its own
   * `ShotPackStep.hint` — every pack step already ships one, so the server never
   * has to synthesize an opening line out of a corrective one. A missing `ready`
   * likewise just means no settle line: the shot still fires on its gates. */
  directions: LookBriefDirection[]
  /** LEGACY, for builds that predate triggers: `directions` projected to a flat
   * ordered script. Derived server-side rather than generated separately, so the
   * two shapes cannot drift apart. */
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
// Deliberately one BELOW the trigger vocabulary size: the sanitizer's own cap is
// structural (at most one line per trigger), and holding the model to 6 keeps the
// legacy `directionLines` projection inside the 3-6 script contract that
// pre-trigger builds were shipped against.
const LOOK_BRIEF_MAX_DIRECTION_LINES = 6

const LOOK_BRIEF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'poseRules', 'directions'],
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
    directions: {
      type: 'array',
      minItems: 3,
      maxItems: LOOK_BRIEF_MAX_DIRECTION_LINES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['trigger', 'line'],
        properties: {
          trigger: { type: 'string', enum: [...DIRECTION_TRIGGER_KINDS] },
          line: {
            type: 'string',
            description:
              'What to say in that state, spoken aloud (max 90 characters).',
          },
        },
      },
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
  'and speakable — the app reads them aloud to the pro while they shoot. Your ' +
  'direction is not a script read in order: each line is bound to a state the ' +
  'camera can detect, and the app speaks it at the moment that state is true. ' +
  'So write each line as the thing a photographer would say RIGHT THEN.'

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
    '- directions: 3–6 direction lines, each bound to the camera state that should SPEAK it. At most one line per trigger:',
    '  - opening → the shot just began: the expression and mood you want',
    '  - subjectTooFar → they fill less of the frame than this shot wants',
    '  - subjectTooClose → they fill more of the frame than this shot wants',
    '  - faceMissing → this shot needs their face and it is not in frame',
    '  - eyesClosed → they blinked and this shot wants eyes open',
    '  - poseUnmet → they are out of the pose this shot calls for',
    '  - ready → everything is right; the last word before the shutter',
    '  ALWAYS include opening and ready. Add a corrective trigger ONLY where THIS look needs it said a particular way',
    '  — a generic correction is already handled on-device, so a line that could fit any shoot is wasted.',
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

/** Keep the first usable line per trigger and return them in canonical coaching
 * order, so the ordering the app (and the legacy script) sees is ours, not
 * whatever order the model happened to emit. Unknown trigger kinds are dropped
 * on the same forward-compat contract as unknown pose-rule kinds. The
 * one-line-per-trigger rule is what bounds the result — there is no separate cap
 * to trim against, and so no branch that could silently drop the settle line. */
function sanitizeDirections(value: unknown): LookBriefDirection[] {
  if (!Array.isArray(value)) return []

  const lineByTrigger = new Map<DirectionTriggerKind, string>()
  for (const item of value) {
    if (!isRecord(item)) continue

    const rawTrigger = pickString(item.trigger)
    const trigger: DirectionTriggerKind | undefined =
      DIRECTION_TRIGGER_KINDS.find((known) => known === rawTrigger)
    if (!trigger || lineByTrigger.has(trigger)) continue

    const line = cleanLine(item.line, 140)
    if (!line) continue

    lineByTrigger.set(trigger, line)
  }

  const directions: LookBriefDirection[] = []
  for (const trigger of DIRECTION_TRIGGER_KINDS) {
    const line = lineByTrigger.get(trigger)
    if (line !== undefined) directions.push({ trigger, line })
  }
  return directions
}

function sanitizeLookBrief(raw: unknown): LookBrief {
  if (!isRecord(raw)) {
    throw new CameraVisionError('bad_output', 'Malformed look brief.')
  }

  const directions = sanitizeDirections(raw.directions)
  if (directions.length === 0) {
    throw new CameraVisionError('bad_output', 'Look brief had no direction.')
  }

  return {
    summary: cleanLine(raw.summary, 140),
    poseRules: sanitizePoseRules(raw.poseRules),
    directions,
    directionLines: directions.map((direction) => direction.line),
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

const CRITIQUE_MAX_STRENGTHS = 4

/** The critique's text budgets, in one place because the prompt and the
 * sanitizer used to carry two different sets of numbers (the prompt asked for
 * 140/120, the sanitizer cut at 200/160).
 *
 * `max` is what `sanitizeCritique` enforces: `cleanLine` hard-slices there,
 * mid-word, with no ellipsis. It is the longest string the shipped iOS card can
 * ever be handed, so it is contract — never widen it here.
 *
 * `aim` is what the prompt asks for, deliberately below `max`. A note now
 * carries three beats and the last of them is the good news; one cut mid-praise
 * reads worse than two that finish. Both numbers go into the prompt, so the aim
 * is a target with a stated reason rather than a ceiling the model has no cause
 * to respect. */
const CRITIQUE_TEXT_LIMITS = {
  note: { aim: 160, max: 200 },
  retakeTip: { aim: 120, max: 160 },
  strength: { aim: 110, max: 160 },
  overall: { aim: 260, max: 400 },
} as const

function charBudget(limit: { aim: number; max: number }): string {
  return `aim for ${limit.aim} characters — anything past ${limit.max} is cut off mid-word`
}

const CRITIQUE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'strengths', 'photos'],
  properties: {
    overall: {
      type: 'string',
      description: `The set in at most 3 short sentences: what to publish and why, the one thing to reshoot, what the set gives them once that is done (${charBudget(CRITIQUE_TEXT_LIMITS.overall)}).`,
    },
    strengths: {
      type: 'array',
      maxItems: CRITIQUE_MAX_STRENGTHS,
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
            description: `The photographer’s read on this photo: what it already has, the one thing to change, then what that change buys (${charBudget(CRITIQUE_TEXT_LIMITS.note)}).`,
          },
          retakeTip: {
            type: 'string',
            description: `For retakes only: the fix on its own, in shooting terms, with no praise in it (${charBudget(CRITIQUE_TEXT_LIMITS.retakeTip)}). Empty string otherwise.`,
          },
        },
      },
    },
  },
}

const CRITIQUE_SYSTEM =
  'You are a beauty-industry photographer standing beside a professional, ' +
  'looking through the set they just shot. You talk the way a photographer ' +
  'talks at the chair: what the photograph already has, the one thing you ' +
  'would change, and what that change buys. You are direct and specific, and ' +
  'you never flatter — a compliment the pro cannot check is the one thing ' +
  'they cannot act on, and it spends the trust every other line depends on. ' +
  'The pro is deciding right now what to publish and what to reshoot while ' +
  'the client is still in the room.'

function critiqueInstructions(args: {
  photoCount: number
  serviceName: string | null
}): string {
  const service = args.serviceName ? `a ${args.serviceName}` : 'a beauty'

  return [
    `The ${args.photoCount} photos above are the before/after set of ${service} appointment.`,
    '',
    'Judge: sharpness on the subject, exposure and light direction, color, framing/crop, background, pose/expression — and whether AFTER shots actually showcase the finished work.',
    '',
    'Every read you write has the same three beats, in this order:',
    '  1. STRENGTH — what the photograph already has, named so the pro can point at it in the frame: the light on the crown, the sharpness at the ends, the clean edge along the hairline, the color holding true.',
    '  2. CHANGE — the one thing to do differently. On a retake: the problem and the fix. On a keep: the single thing holding it out of the portfolio. On a portfolio shot: the move that produced beat 1, said so they can repeat it on the next frame.',
    '  3. CLOSE — what beat 1 becomes once beat 2 is done. A consequence, not a compliment.',
    '',
    'For EVERY photo return:',
    '- index: its 1-based number from the labels.',
    "- verdict: 'portfolio' (hero shot — feed/portfolio worthy), 'keep' (solid documentation, not a hero), or 'retake' (weak but fixable right now).",
    `- note: the three beats as one short paragraph (${charBudget(CRITIQUE_TEXT_LIMITS.note)}).`,
    `- retakeTip: for retakes only, the fix on its own as a bare instruction in shooting terms — angle, light, focus, framing — with no praise in it at all, because it prints under the note as the thing to go and do (${charBudget(CRITIQUE_TEXT_LIMITS.retakeTip)}). Empty string otherwise.`,
    '',
    'What keeps this a review and not a compliment:',
    '- Beat 1 has to name something visible in that frame. If the pro cannot look at the photo and see the thing you named, it is not a strength. Never write “great energy”, “lovely vibe”, “stunning”, “beautiful work”, “you nailed it” — none of those can be checked, so none of them are worth anything at the chair.',
    '- Praise the photograph, never the professional and never the client. No superlatives, no exclamation marks.',
    '- If a photograph genuinely has no strength, lead with the problem and skip beat 1. Never invent one to fill the shape: a manufactured strength is how a pro ends up publishing a bad photo.',
    '- A retake still has to read as a retake. Name the problem plainly, and let the close point at the reshoot rather than at settling for the frame. Never soften it with “still usable”, “fine as is”, or “could go either way”.',
    '- The verdict is a decision, not a kindness. A frame that needs reshooting is a retake however good its strength is: the strength is the reason to go back and get it, not a reason to keep it.',
    '- No scores, no grades, no ratings out of ten, no percentages.',
    '',
    `Also return strengths: 2–4 things the SET does well, each one checkable — name the photo number or the element you mean. Per strength: ${charBudget(CRITIQUE_TEXT_LIMITS.strength)}.`,
    `And overall: the same three beats for the set — what to publish and why, the one thing to reshoot before the client leaves, what the set gives them once that is done. At most 3 short sentences (${charBudget(CRITIQUE_TEXT_LIMITS.overall)}).`,
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

      const retakeTip = cleanLine(
        item.retakeTip,
        CRITIQUE_TEXT_LIMITS.retakeTip.max,
      )
      notesById.set(id, {
        id,
        verdict,
        note: cleanLine(item.note, CRITIQUE_TEXT_LIMITS.note.max),
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
    overall: cleanLine(raw.overall, CRITIQUE_TEXT_LIMITS.overall.max),
    strengths: cleanLines(
      raw.strengths,
      CRITIQUE_MAX_STRENGTHS,
      CRITIQUE_TEXT_LIMITS.strength.max,
    ),
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
