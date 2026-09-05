import type { BrandClientConsultInspirationCopy } from './types'

// P5c — every sentence the guided-inspiration step says, in one file.
//
// These four were literals inside lib/consult/inspirationPack.ts, which is
// also where the hair-colour question list lived. Splitting them out is what
// lets a second service family ask its own questions without inheriting hair's
// words, and it is the white-label rule: user-facing copy comes from
// lib/brand, never from a contract module.
//
// The sentences are UNCHANGED from the ones the step has been showing since
// C10 — this move is not a re-write. The voice is the app's: it explains what
// a reference picture is FOR and, quietly, what it is not.
export const defaultClientConsultInspirationCopy: BrandClientConsultInspirationCopy =
  {
    introduction:
      'An inspiration picture is optional. It can help you and your professional get visually on the same page.',

    // 🔴 Load-bearing, not decoration. A photograph of someone else's hair is
    // the single easiest place for a client to hear a promise that nobody
    // made, so the step says so in her own view, every time.
    referenceNote:
      'Use it as a reference, not a guarantee or something that can be copied directly onto you.',

    reflectionPromptHair:
      'A complete look can include color, length, fullness, and styling. Take a moment to choose what actually stands out to you.',
    reflectionPrompt:
      'A picture can be about several things at once. Take a moment to choose what actually stands out to you.',

    // Shown when a detail she picked out may be a service of its own. It says
    // the thing a client actually needs to know — that nothing was added to
    // her booking behind her back — and hands the question to her
    // professional rather than answering it.
    catalogGuidanceNote:
      'This part of the complete look may involve a separate service your professional already offers. Ask what applies; nothing was added to this booking.',
  }
