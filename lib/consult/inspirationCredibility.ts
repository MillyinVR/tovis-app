// lib/consult/inspirationCredibility.ts
//
// C2-6b (gap G2) — the credibility flags on the inspiration reading, turned
// into the two sentences they exist for: the client's, in the thread, and the
// pro's, on the Brief and in the mentor layer.
//
// Flags are ENUMS on the wire and SENTENCES on read. Both composers are pure,
// deterministic, and take their every word from a copy table — the client's
// from the tenant's inspiration copy, the pro's from a plain const. A flag
// that has no words in a table is dropped from that sentence rather than
// echoed, because the value is an internal code and a code on a screen is
// the failure the copy tables exist to prevent. Both return null when there
// is nothing to say, so a caller renders nothing rather than a placeholder.
//
// No provider, no prisma: `credibilityFlags` is already sanitized to the
// vocabulary by the time it is stored (lib/consult/inspirationVision.ts) and
// by the time it is read back (lib/consult/inspirationAnalysisRead.ts).

import { consultProInspirationCredibilityCopy } from '@/lib/brand/consultProInspirationCredibilityCopy'
import type { BrandClientConsultInspirationCopy } from '@/lib/brand/types'
import type { ConsultInspirationCredibilityFlagDTO } from '@/lib/dto/consult'

import { joinClauses } from './inspiration/cards'
import { CONSULT_INSPIRATION_CREDIBILITY_FLAGS } from './inspirationAttributes'

/**
 * The stored order, whatever order the flags arrived in, so the same reading
 * always produces the same sentence.
 */
function ordered(
  flags: readonly ConsultInspirationCredibilityFlagDTO[],
): ConsultInspirationCredibilityFlagDTO[] {
  return CONSULT_INSPIRATION_CREDIBILITY_FLAGS.filter((flag) => flags.includes(flag))
}

/**
 * The client's sentence, in the app's voice: what was noticed about the
 * picture, then the Blueprint's reassurance. Null when no flag has words.
 * Clauses are joined by the cards' own `joinClauses`, so this sentence and
 * the understanding check list things the same way.
 */
export function composeConsultInspirationCredibilityClientNote(
  flags: readonly ConsultInspirationCredibilityFlagDTO[],
  copy: BrandClientConsultInspirationCopy,
): string | null {
  const clauses = ordered(flags).flatMap((flag) => {
    const clause = copy.credibility.flags[flag]
    return clause ? [clause] : []
  })
  if (clauses.length === 0) return null
  const lead = copy.credibility.lead.replaceAll(
    '{clauses}',
    joinClauses(clauses, copy.credibility.conjunction),
  )
  return `${lead} ${copy.credibility.close}`
}

/**
 * The pro's line: the flags as short colourist phrases. Null when no flag has
 * words.
 */
export function composeConsultInspirationCredibilityProLine(
  flags: readonly ConsultInspirationCredibilityFlagDTO[],
): string | null {
  const copy = consultProInspirationCredibilityCopy
  const phrases = ordered(flags).flatMap((flag) => {
    const phrase = copy.flags[flag]
    return phrase ? [phrase] : []
  })
  if (phrases.length === 0) return null
  return copy.line.replaceAll('{flags}', phrases.join(copy.separator))
}
