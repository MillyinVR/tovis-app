// Trending "shot packs" for the native AI-photographer camera — server-driven
// pose/shot recipes the camera turns into a directed shoot (guide steps +
// per-step expectations + pose rules the on-device coach enforces).
//
// WHY SERVER-SIDE: what's going viral changes weekly; the app ships a fixed
// VOCABULARY of pose-rule kinds it knows how to measure (see `PoseRuleKind`),
// and packs compose those primitives into current trends. Updating this file
// (or later, generating packs from Looks-feed engagement) refreshes every
// pro's camera without an app release. The app SKIPS rule kinds it doesn't
// recognize, so new vocabulary can ship here ahead of older app builds.
//
// v1 is editorially curated around evergreen-viral beauty formats (the reveal,
// the over-shoulder glance, hands-framing-face nail shots, golden-hour glow).
// Bump `SHOT_PACKS_VERSION` on every content change — clients use it to cache.

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

export type ShotPack = {
  id: string
  name: string
  /** One-line seller shown under the pack name in the picker. */
  tagline: string
  /** Lowercased keywords matched against the booking's base service name. */
  serviceKeywords: string[]
  /** Editorial ranking, higher = hotter — the picker sorts by this. */
  trendScore: number
  steps: ShotPackStep[]
}

export const SHOT_PACKS_VERSION = 1

const REVEAL: ShotPack = {
  id: 'hair-reveal-v1',
  name: 'The Reveal',
  tagline: 'The transformation money-shot set — back canvas first, then the turn.',
  serviceKeywords: ['hair', 'cut', 'color', 'colour', 'balayage', 'blowout', 'extensions', 'style', 'braid'],
  trendScore: 100,
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

const OVER_SHOULDER: ShotPack = {
  id: 'over-shoulder-glance-v1',
  name: 'Over-Shoulder Glance',
  tagline: 'The look-back everyone saves — soft, confident, editorial.',
  serviceKeywords: ['hair', 'makeup', 'glam', 'style', 'braid', 'extensions'],
  trendScore: 90,
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

const CLAW_AND_SPARKLE: ShotPack = {
  id: 'nails-claw-sparkle-v1',
  name: 'Claw & Sparkle',
  tagline: 'Hands framing the face — the nail set that stops the scroll.',
  serviceKeywords: ['nail', 'mani', 'gel', 'acrylic', 'pedi'],
  trendScore: 85,
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

const GOLDEN_GLOW: ShotPack = {
  id: 'makeup-golden-glow-v1',
  name: 'Golden Glow',
  tagline: 'Soft-light profile + closed-eye shimmer — the glow reel staple.',
  serviceKeywords: ['makeup', 'glam', 'facial', 'skin', 'brow', 'lash'],
  trendScore: 80,
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

const SHOT_PACKS: ShotPack[] = [REVEAL, OVER_SHOULDER, CLAW_AND_SPARKLE, GOLDEN_GLOW]

/** The current trending packs, hottest first. */
export function loadCameraShotPacks(): { version: number; packs: ShotPack[] } {
  return {
    version: SHOT_PACKS_VERSION,
    packs: [...SHOT_PACKS].sort((a, b) => b.trendScore - a.trendScore),
  }
}
