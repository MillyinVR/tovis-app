// C2-6b — the pro's one line about the reference photograph (gap G2).
//
// "Reference note: looks edited or filtered; lit like a photo shoot." Composed
// deterministically by lib/consult/inspirationCredibility.ts from the enum
// flags on the inspiration reading — no model call — so this table is the
// ONLY source of words the line can contain. A flag with no entry here is
// dropped from the line, never echoed: a flag is an internal code, and the
// rule (memory: "a model quotes your internal codes back at the client") holds
// for a composer just as it does for a model.
//
// A plain const like consultProBriefTopLineCopy: professional surfaces are
// not tenant-themed. Nothing here reaches a client — her sentence is
// `credibility` in lib/brand/defaultClientConsultInspirationCopy.ts.
//
// Every flag in CONSULT_INSPIRATION_CREDIBILITY_FLAGS has an entry;
// inspirationCredibility.test.ts fails the build for one that does not.
export const consultProInspirationCredibilityCopy = {
  /** `{flags}` is the joined list of phrases below. */
  line: 'Reference note: {flags}.',
  /** Between phrases — a semicolon, because a phrase can carry a comma. */
  separator: '; ',
  flags: {
    LIKELY_EDITED: 'looks edited or filtered',
    LIKELY_AI_GENERATED: 'may be AI-generated, not real hair',
    EXTENSIONS_LIKELY: 'extensions likely',
    PRO_LIGHTING: 'lit like a photo shoot',
    FINISH_HIDES_CUT: 'the finish hides the cut',
    SINGLE_ANGLE: 'one angle only',
  } as Readonly<Record<string, string>>,
} as const

export type ConsultProInspirationCredibilityCopy =
  typeof consultProInspirationCredibilityCopy
