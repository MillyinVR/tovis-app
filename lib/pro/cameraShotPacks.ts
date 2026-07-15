// Trending "shot packs" for the native AI-photographer camera — server-driven
// pose/shot recipes (guide steps + per-step expectations + pose rules the
// on-device coach enforces).
//
// WHY SERVER-SIDE: what's going viral changes weekly; the app ships a fixed
// VOCABULARY of pose-rule kinds it knows how to measure (see `PoseRuleKind`),
// and packs compose those primitives into current trends. Updating this file
// refreshes every pro's camera without an app release. The app SKIPS rule kinds
// it doesn't recognize, so new vocabulary can ship here ahead of older builds.
//
// The pack CONTENT (steps + pose rules) stays editorially curated around
// evergreen-viral beauty formats (the reveal, the over-shoulder glance,
// hands-framing-face nail shots, golden-hour glow) — that vocabulary is fixed
// and app-measured, and nothing in the Looks corpus tags a look by shot format,
// so it can't be mined from engagement. What IS engagement-driven (C10) is the
// ORDER packs appear in: each pack carries an editorial `baseTrendScore` and the
// service families it belongs to, and `loadCameraShotPacks` blends a bounded,
// field-relative "how hot is this family in the Looks feed right now?" lift on
// top of the base (lib/looks/categoryTrendStats.ts). With no trend data the lift
// is zero and the ordering is exactly the editorial base — byte-identical to the
// pre-C10 payload — so the signal can only reorder packs, never break the camera.
//
// Bump `SHOT_PACKS_VERSION` on every CONTENT change (packs/steps/vocabulary);
// clients cache against the response ETag, which also folds the live ordering so
// an engagement-driven reorder invalidates a stale cache without a version bump.

import { createHash } from 'node:crypto'

import {
  fetchCategoryTrendStrengths,
  type CategoryTrendStatReader,
} from '@/lib/looks/categoryTrendStats'

/** Pose-rule kinds the iOS coach can currently measure. Adding a kind here
 * requires the matching evaluator in the app (older apps skip unknown kinds).
 *  - handNearFace — a wrist within params.maxFaceHeights of the face center
 *  - bothHandsVisible — both wrists confidently in frame
 *  - shouldersTilted — shoulder line at least params.minDegrees off level
 *  - shouldersLevel — shoulder line within params.maxDegrees of level
 *  - faceNearShoulder — face center within params.maxFaceWidths of a shoulder
 *
 * Kept as a runtime array (type derived from it) so server-side consumers —
 * e.g. the Claude-vision look brief — can validate rules against the same
 * single source of truth. */
export const POSE_RULE_KINDS = [
  'handNearFace',
  'bothHandsVisible',
  'shouldersTilted',
  'shouldersLevel',
  'faceNearShoulder',
] as const

export type PoseRuleKind = (typeof POSE_RULE_KINDS)[number]

export type ShotPackPoseRule = {
  kind: PoseRuleKind
  /** Kind-specific numeric parameters (units documented per kind above). */
  params?: Record<string, number>
  /** The directive the coach speaks/shows while the rule is unmet. */
  tip: string
}

export type ShotPackStep = {
  title: string
  hint: string
  /** SF Symbol name for the guide bar. */
  icon: string
  /** Whether the subject's face belongs in this shot. */
  face: 'required' | 'absent' | 'either'
  /** Target subject-fill band (person segmentation), both-or-neither. */
  fillBandMin: number | null
  fillBandMax: number | null
  /** Detail/macro shot: extra sharpness demanded, backdrop ignored. */
  isDetail: boolean
  /** Closed eyes are intended (skip the blink check). */
  allowsClosedEyes: boolean
  /** Pose rules the coach enforces before auto-capture fires. */
  pose: ShotPackPoseRule[]
}

/** The wire shape served to the app — unchanged by C10 (the client still sorts
 * by `trendScore` and matches `serviceKeywords`). `trendScore` is now the
 * editorial base blended with the live engagement lift, rounded to an integer
 * (the iOS decoder types it as `Int`). */
export type ShotPack = {
  id: string
  name: string
  /** One-line seller shown under the pack name in the picker. */
  tagline: string
  /** Lowercased keywords matched against the booking's base service name. */
  serviceKeywords: string[]
  /** Ranking, higher = hotter — the picker sorts by this. */
  trendScore: number
  steps: ShotPackStep[]
}

/** Server-only pack authoring shape: the wire fields minus the computed
 * `trendScore`, plus the editorial base and the service families whose Looks-feed
 * heat lifts this pack. `categorySlugs` are TOP-LEVEL family slugs (matched
 * against LookCategoryTrendStat, which is keyed by family root). */
type ShotPackDefinition = Omit<ShotPack, 'trendScore'> & {
  baseTrendScore: number
  categorySlugs: string[]
}

export const SHOT_PACKS_VERSION = 1

// The most a maximally-hot family can add to a pack's editorial base. Sized to
// let a red-hot lower pack overtake a cold higher one (base spread is ~20)
// without letting engagement obliterate the curation — comparable to the
// personalization boost bands (follow 25 / relationship 30).
export const SHOT_PACK_TREND_MAX_LIFT = 30

const REVEAL: ShotPackDefinition = {
  id: 'hair-reveal-v1',
  name: 'The Reveal',
  tagline: 'The transformation money-shot set — back canvas first, then the turn.',
  serviceKeywords: ['hair', 'cut', 'color', 'colour', 'balayage', 'blowout', 'extensions', 'style', 'braid'],
  baseTrendScore: 100,
  categorySlugs: ['hair'],
  steps: [
    {
      title: 'Back canvas',
      hint: 'Square to their back — the full color & shape, edges sharp',
      icon: 'arrow.uturn.down',
      face: 'absent',
      fillBandMin: 0.25,
      fillBandMax: 0.9,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [
        { kind: 'shouldersLevel', params: { maxDegrees: 6 }, tip: 'Square their shoulders to the camera' },
      ],
    },
    {
      title: 'The turn',
      hint: 'Chin to the shoulder, eyes back to the lens — hold it',
      icon: 'arrow.turn.up.left',
      face: 'required',
      fillBandMin: 0.22,
      fillBandMax: 0.85,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [
        { kind: 'faceNearShoulder', params: { maxFaceWidths: 1.1 }, tip: 'Bring their chin toward the shoulder' },
      ],
    },
    {
      title: 'Texture close-up',
      hint: 'In tight on the movement — ends and tone razor sharp',
      icon: 'magnifyingglass',
      face: 'either',
      fillBandMin: null,
      fillBandMax: null,
      isDetail: true,
      allowsClosedEyes: false,
      pose: [],
    },
  ],
}

const OVER_SHOULDER: ShotPackDefinition = {
  id: 'over-shoulder-glance-v1',
  name: 'Over-Shoulder Glance',
  tagline: 'The look-back everyone saves — soft, confident, editorial.',
  serviceKeywords: ['hair', 'makeup', 'glam', 'style', 'braid', 'extensions'],
  baseTrendScore: 90,
  categorySlugs: ['hair', 'makeup'],
  steps: [
    {
      title: 'Three-quarter back',
      hint: 'Turn them ~45° away, weight on the back foot',
      icon: 'person.fill.turn.left',
      face: 'either',
      fillBandMin: 0.22,
      fillBandMax: 0.85,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [
        { kind: 'shouldersTilted', params: { minDegrees: 6 }, tip: 'Drop their front shoulder a touch' },
      ],
    },
    {
      title: 'The glance',
      hint: 'Chin to shoulder, eyes to the lens — shoot on the settle',
      icon: 'eye.fill',
      face: 'required',
      fillBandMin: 0.22,
      fillBandMax: 0.85,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [
        { kind: 'faceNearShoulder', params: { maxFaceWidths: 1.1 }, tip: 'Chin closer to the shoulder' },
      ],
    },
  ],
}

const CLAW_AND_SPARKLE: ShotPackDefinition = {
  id: 'nails-claw-sparkle-v1',
  name: 'Claw & Sparkle',
  tagline: 'Hands framing the face — the nail set that stops the scroll.',
  serviceKeywords: ['nail', 'mani', 'gel', 'acrylic', 'pedi'],
  baseTrendScore: 85,
  categorySlugs: ['nails'],
  steps: [
    {
      title: 'Frame the face',
      hint: 'Both hands up under the chin, nails toward the lens',
      icon: 'hands.sparkles.fill',
      face: 'required',
      fillBandMin: null,
      fillBandMax: null,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [
        { kind: 'bothHandsVisible', tip: 'Bring both hands into frame' },
        { kind: 'handNearFace', params: { maxFaceHeights: 1.3 }, tip: 'Hands up by their face' },
      ],
    },
    {
      title: 'Top-down grid',
      hint: 'Straight above the spread fingers on a clean surface',
      icon: 'arrow.down',
      face: 'either',
      fillBandMin: null,
      fillBandMax: null,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [{ kind: 'bothHandsVisible', tip: 'Both hands flat in the frame' }],
    },
    {
      title: 'Macro shine',
      hint: 'One nail, low angle — catch the sparkle',
      icon: 'magnifyingglass',
      face: 'either',
      fillBandMin: null,
      fillBandMax: null,
      isDetail: true,
      allowsClosedEyes: false,
      pose: [],
    },
  ],
}

const GOLDEN_GLOW: ShotPackDefinition = {
  id: 'makeup-golden-glow-v1',
  name: 'Golden Glow',
  tagline: 'Soft-light profile + closed-eye shimmer — the glow reel staple.',
  serviceKeywords: ['makeup', 'glam', 'facial', 'skin', 'brow', 'lash'],
  baseTrendScore: 80,
  categorySlugs: ['makeup', 'skin', 'brows', 'lashes'],
  steps: [
    {
      title: 'Lit profile',
      hint: 'Turn them toward the light, 45° profile, shoulders soft',
      icon: 'sun.max.fill',
      face: 'required',
      fillBandMin: 0.22,
      fillBandMax: 0.85,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [
        { kind: 'shouldersLevel', params: { maxDegrees: 8 }, tip: 'Relax and level their shoulders' },
      ],
    },
    {
      title: 'Closed-eye shimmer',
      hint: 'Eyes closed, chin a touch down — lids do the talking',
      icon: 'eye.slash.fill',
      face: 'either',
      fillBandMin: null,
      fillBandMax: null,
      isDetail: true,
      allowsClosedEyes: true,
      pose: [],
    },
    {
      title: 'The open',
      hint: 'Eyes open straight to the lens — catchlights sharp',
      icon: 'eye.fill',
      face: 'required',
      fillBandMin: 0.22,
      fillBandMax: 0.85,
      isDetail: false,
      allowsClosedEyes: false,
      pose: [],
    },
  ],
}

const SHOT_PACK_DEFINITIONS: ShotPackDefinition[] = [
  REVEAL,
  OVER_SHOULDER,
  CLAW_AND_SPARKLE,
  GOLDEN_GLOW,
]

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

/**
 * Blend the editorial pack definitions with the live per-family trend strengths
 * and return the wire packs hottest-first. A pack's lift comes from its HOTTEST
 * matching family (max over its categorySlugs), so pairing a hot family with a
 * cold one never dilutes the signal. Deterministic: ties break on the editorial
 * base then the pack id, so an all-zero (dark) strength map reproduces the exact
 * editorial ordering. Pure — unit-tested without a DB.
 */
export function rankShotPacks(
  definitions: readonly ShotPackDefinition[],
  strengthBySlug: ReadonlyMap<string, number>,
): ShotPack[] {
  const scored = definitions.map((definition) => {
    const strength = clamp01(
      Math.max(
        0,
        ...definition.categorySlugs.map((slug) => strengthBySlug.get(slug) ?? 0),
      ),
    )
    const trendScore = Math.round(
      definition.baseTrendScore + SHOT_PACK_TREND_MAX_LIFT * strength,
    )
    return { definition, trendScore }
  })

  scored.sort((a, b) => {
    if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore
    if (b.definition.baseTrendScore !== a.definition.baseTrendScore) {
      return b.definition.baseTrendScore - a.definition.baseTrendScore
    }
    return a.definition.id < b.definition.id
      ? -1
      : a.definition.id > b.definition.id
        ? 1
        : 0
  })

  return scored.map(({ definition, trendScore }) => ({
    id: definition.id,
    name: definition.name,
    tagline: definition.tagline,
    serviceKeywords: definition.serviceKeywords,
    trendScore,
    steps: definition.steps,
  }))
}

export type ShotPacksPayload = { version: number; packs: ShotPack[] }

/**
 * A weak ETag that folds BOTH the content version and the live ordering, so a
 * pure content change (version bump) AND an engagement-driven reorder each
 * invalidate a stale client cache. Identical payloads share an ETag, so the
 * client cache still hits across a day of unchanged rankings. Pure/deterministic.
 */
export function buildShotPacksEtag(payload: ShotPacksPayload): string {
  const signature = payload.packs
    .map((pack) => `${pack.id}:${pack.trendScore}`)
    .join('|')
  const digest = createHash('sha1')
    .update(`v${payload.version}\n${signature}`)
    .digest('hex')
    .slice(0, 12)
  return `W/"shot-packs-${payload.version}-${digest}"`
}

/**
 * The current trending packs, hottest first. Reads the per-family engagement
 * trend and blends it into the editorial order. The trend read is best-effort:
 * any failure falls back to the editorial ordering (empty strengths) rather than
 * failing the camera — mirroring the app's own "silent failure → standard guides
 * carry the shoot" contract.
 */
export async function loadCameraShotPacks(
  db: CategoryTrendStatReader,
): Promise<ShotPacksPayload> {
  let strengthBySlug: ReadonlyMap<string, number> = new Map()
  try {
    strengthBySlug = await fetchCategoryTrendStrengths(db)
  } catch (error) {
    console.error(
      'loadCameraShotPacks: trend read failed, using editorial order',
      error,
    )
  }
  return {
    version: SHOT_PACKS_VERSION,
    packs: rankShotPacks(SHOT_PACK_DEFINITIONS, strengthBySlug),
  }
}
