// C2-6a — the one-line synthesis at the top of the pro Brief (gap G6).
//
// Blueprint 12.1: "Client wants [visual result] because [underlying goal].
// Must preserve [non-negotiables] and avoid [dealbreakers]." Composed
// deterministically by lib/consult/briefTopLine.ts — no model call — so this
// table is the ONLY source of words the sentence can contain. A value that has
// no entry here is dropped from the sentence, never echoed: an intake or card
// value is an internal code, and the rule (memory: "a model quotes your
// internal codes back at the client") holds for a composer just as it does for
// a model.
//
// A plain const like consultProFollowUpCopy: professional surfaces are not
// tenant-themed. Nothing here reaches a client.
//
// `{placeholders}` are filled by the composer. The two sentences are built from
// parts so that any part whose evidence is absent is simply left out; there is
// no wording for "unknown".
export const consultProBriefTopLineCopy = {
  // ── Sentence 1: what she wants, and why ────────────────────────────────────
  /** "Client wants {wants}" — `wants` is already a joined list of phrases. */
  wants: 'Client wants {wants}',
  /** Appended to `wants` when the client set a match intent on the cards. */
  lookMatch: {
    'match-selected-parts': ' (as close to the picture as possible)',
    'adapt-selected-parts': ' (adapted to the client)',
  } as Readonly<Record<string, string>>,
  /** Appended to `wants` when intake gave a reason. `goal` is a phrase below. */
  because: ' because the goal is {goal}',
  /** The whole first sentence when there are no wants but intake gave a reason. */
  goalOnly: 'Client is after {goal}',
  /** Both intake reasons present: the scale first, the direction as the detail. */
  goalScaleAndDirection: '{scale}, mainly {direction}',
  /**
   * What a reference stands for when the client brought one but no tap
   * settled a specific part of it — every card "not sure", or a photograph
   * the reading could not settle any region of. Also the words for the
   * "the whole thing" spark tap.
   */
  overallLook: 'the overall look',
  /** A region she tapped, named from the reading's own short name. */
  regionWant: 'the {name}',

  // ── Sentence 2: what must not change, and what to steer clear of ───────────
  preserve: 'Must preserve {keep}',
  preserveAndAvoid: 'Must preserve {keep} and avoid {avoids}',
  avoid: 'Must avoid {avoids}',

  /** "a, b and c" */
  conjunction: 'and',

  // ── Value tables. Keyed `question:value`; a missing key drops the value. ───
  sparkFocus: {
    'the-color': 'the color',
    'the-cut': 'the cut',
    'the-layers': 'the layers',
    'the-movement': 'the movement',
    'the-length': 'the length',
    'the-fullness': 'the fullness',
    'the-shape': 'the shape',
  } as Readonly<Record<string, string>>,
  keep: {
    'keep_as_is:my-length': 'the length',
    'keep_as_is:my-color': 'the current color',
    'keep_as_is:my-natural-roots': 'the natural roots',
    'keep_as_is:my-natural-texture': 'the natural texture',
    'keep_as_is:my-natural-shape': 'the natural shape',
    // The v5 root card's own "keep my natural root color" answer.
    'color_roots:keep-natural': 'the natural roots',
  } as Readonly<Record<string, string>>,
  changeScale: {
    subtle: 'a small change',
    noticeable: 'a change people will notice',
    total: 'a completely different look',
  } as Readonly<Record<string, string>>,
  /**
   * Every pack's goal-direction values, as a phrase that follows "the goal
   * is". The three packs use disjoint value sets, so one table serves all.
   * `not-sure` is deliberately absent: an unresolved goal is not a reason.
   */
  goalDirection: {
    // hair-color
    lighter: 'going lighter',
    darker: 'going darker',
    warmer: 'a warmer tone',
    'less-warm': 'less warmth',
    'brighter-pieces': 'brighter pieces',
    'softer-root-contrast': 'a softer blend at the roots',
    'gray-blending': 'blending the gray',
    'richer-color': 'a richer color',
    'more-shine': 'more shine',
    // hair-general
    length: 'a change in length',
    'volume-fullness': 'more volume or fullness',
    'shape-style': 'a new shape or style',
    'texture-movement': 'a change in texture or movement',
    'health-condition': 'healthier-looking hair',
    'easier-upkeep': 'easier upkeep',
    // general-service
    shape: 'a change in shape',
    'color-tone': 'a change in color or tone',
    'fullness-definition': 'more fullness or definition',
    'smoothness-condition': 'smoother, better-conditioned results',
    'longer-lasting': 'longer-lasting results',
    'more-natural': 'a more natural look',
    bolder: 'a bolder look',
  } as Readonly<Record<string, string>>,
  /**
   * A maintenance answer that is a dealbreaker. `medium` and `high` are
   * tolerances, not constraints, so they say nothing here.
   */
  maintenanceAvoid: {
    low: 'heavy upkeep',
  } as Readonly<Record<string, string>>,
} as const

export type ConsultProBriefTopLineCopy = typeof consultProBriefTopLineCopy
