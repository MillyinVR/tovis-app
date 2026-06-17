// lib/migration/serviceMatch.ts
//
// Service-matching engine for the pro migration flow. Given a competitor's
// service name (free text from a CSV/export) it suggests the best-fit entries
// from the canonical service catalog, ranked by confidence.
//
// Pure logic — no DB, no React. The caller passes the catalog (sourced from the
// Service table) and optionally an alias table. This is the brain behind the
// Services-mapping auto-suggest; it is deliberately conservative so a wrong
// guess is a cheap dropdown correction, never a silent miss.

export type MatchCatalogEntry = {
  id: string
  name: string
  categoryName?: string
}

export type MatchReason = 'exact' | 'alias' | 'token' | 'fuzzy'

export type ServiceSuggestion = {
  entry: MatchCatalogEntry
  score: number // 0–100
  reason: MatchReason
}

// Score at/above which a suggestion is safe to pre-select in the dropdown.
export const CONFIDENT_SCORE = 70

// Score below which we don't surface a suggestion at all (→ "needs attention").
const MIN_SCORE = 45

// Filler words stripped before token/fuzzy comparison (kept for exact match).
const FILLER = new Set([
  'the',
  'a',
  'an',
  'and',
  'with',
  'w',
  'appt',
  'appointment',
  'service',
  'session',
  'deluxe',
  'signature',
  'classic',
  'standard',
  'premium',
  'mini',
])

// Canonical service name → competitor phrases that mean the same thing.
// Grows alongside the seeded catalog; this is where vendor vocabulary collapses
// onto one clean canonical name.
// Keys MUST match canonical Service names exactly (aliases bind by entry.name).
export const SERVICE_ALIASES: Record<string, string[]> = {
  // Hair — color
  Balayage: ['balayage', 'babylights', 'baby lights', 'hand painted color', 'painted highlights', 'ombre'],
  'Partial Highlights': ['partial highlights', 'partial foil', 'partial foils', 'half head foils', 'foilage'],
  'Full Highlights': ['full highlights', 'full foil', 'full foils', 'full head foils'],
  'All-Over Color': ['all over color', 'single process', 'full color', 'all over', 'base color'],
  'Toner / Gloss': ['toner', 'gloss', 'glaze', 'clear gloss', 'color gloss'],
  'Root Touch-Up': ['root touch up', 'root retouch', 'color retouch', 'root color', 'roots'],
  // Hair — cut & style
  'Haircut & Style': ['haircut', 'cut and style', 'cut and finish', 'womens cut', 'womens haircut', 'ladies cut', 'ladies haircut', 'wash cut style'],
  "Men's Cut": ['mens cut', 'mens haircut', 'barber cut', 'clipper cut', 'fade'],
  Blowout: ['blowout', 'blow dry', 'blow out', 'wash and style'],
  // Hair — treatment / extensions
  'Keratin Smoothing Treatment': ['keratin', 'keratin treatment', 'brazilian blowout', 'smoothing treatment'],
  'Extension Installation': ['extensions install', 'hair extensions', 'tape ins', 'install extensions', 'sew in'],
  // Nails
  'Gel Manicure': ['gel manicure', 'shellac manicure', 'gel polish manicure', 'shellac mani', 'gel mani'],
  'Classic Manicure': ['classic manicure', 'basic manicure', 'manicure', 'regular manicure'],
  'Gel Pedicure': ['gel pedicure', 'shellac pedicure', 'gel pedi'],
  'Acrylic Full Set': ['acrylic full set', 'acrylics', 'acrylic set', 'full set acrylic', 'acrylic nails'],
  'Dip Powder': ['dip powder', 'sns', 'dip nails', 'powder dip', 'dip'],
  'Gel X Full Set': ['gel x', 'gelx', 'gelx full set', 'gel x full set', 'hard gel set', 'gel extensions'],
  // Lashes
  'Classic Lash Full Set': ['classic lashes', 'classic full set', 'classic lash set', 'eyelash extensions full set', 'lash extensions full set'],
  'Volume Lash Full Set': ['volume lashes', 'volume full set', 'volume lash set', 'russian volume'],
  'Lash Fill': ['lash fill', 'lash refill', 'fill in', 'lash fill in'],
  'Lash Lift': ['lash lift', 'lash perm'],
  // Brows
  'Brow Lamination': ['brow lamination', 'brow lam'],
  'Brow Wax & Shape': ['brow wax', 'eyebrow wax', 'brow shaping', 'eyebrow shaping', 'brow shape'],
  // Skin / waxing
  'Classic Facial': ['facial', 'classic facial', 'signature facial', 'express facial'],
  'Brazilian Wax': ['brazilian wax', 'brazilian'],
  // Makeup
  'Soft Glam Makeup': ['soft glam', 'glam makeup', 'event makeup', 'special occasion makeup'],
  'Bridal Makeup': ['bridal makeup', 'wedding makeup', 'bridal trial', 'bridal'],
  // Permanent makeup
  Microblading: ['microblading', 'micro blading', 'permanent brows', 'pmu brows', 'ombre brows', 'powder brows'],
  // Braiding
  'Box Braids': ['box braids', 'braids', 'knotless braids', 'feed in braids', 'cornrows'],
  // Hair removal
  Electrolysis: ['electrolysis', 'electrolysis hair removal', 'permanent hair removal'],
  // Massage
  '60-Minute Swedish Massage': ['swedish massage', '60 min massage', 'relaxation massage', 'full body massage'],
  '60-Minute Deep Tissue': ['deep tissue', 'deep tissue massage', '60 min deep tissue'],
  'Hot Stone Massage': ['hot stone', 'hot stone massage'],
}

export function normalizeServiceName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function coreTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 0 && !FILLER.has(t))
}

function stripFiller(normalized: string): string {
  return coreTokens(normalized).join(' ')
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter += 1
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : inter / union
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (a === b) return 0
  if (m === 0) return n
  if (n === 0) return m

  let prev: number[] = []
  for (let j = 0; j <= n; j += 1) prev[j] = j

  for (let i = 1; i <= m; i += 1) {
    const curr: number[] = [i]
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const del = (prev[j] ?? 0) + 1
      const ins = (curr[j - 1] ?? 0) + 1
      const sub = (prev[j - 1] ?? 0) + cost
      curr[j] = Math.min(del, ins, sub)
    }
    prev = curr
  }
  return prev[n] ?? 0
}

function fuzzyRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

type AliasIndex = Map<string, Set<string>> // normalized alias phrase → canonical names

function buildAliasIndex(aliases: Record<string, string[]>): AliasIndex {
  const index: AliasIndex = new Map()
  for (const [canonical, phrases] of Object.entries(aliases)) {
    for (const phrase of phrases) {
      const key = normalizeServiceName(phrase)
      if (!index.has(key)) index.set(key, new Set())
      index.get(key)!.add(canonical)
    }
  }
  return index
}

function scoreEntry(
  inputNormFull: string,
  inputCore: string,
  inputTokens: string[],
  entry: MatchCatalogEntry,
  aliasIndex: AliasIndex,
  aliasPhrasesForEntry: string[],
): { score: number; reason: MatchReason } {
  const entryNormFull = normalizeServiceName(entry.name)
  const entryCore = stripFiller(entryNormFull)

  // Exact (on full normalized form, filler included).
  if (inputNormFull === entryNormFull || inputCore === entryCore) {
    return { score: 100, reason: 'exact' }
  }

  let best = 0
  let reason: MatchReason = 'fuzzy'

  // Alias: input phrase is a known synonym of this canonical name.
  const aliasCanonicals = aliasIndex.get(inputNormFull) ?? aliasIndex.get(inputCore)
  if (aliasCanonicals && aliasCanonicals.has(entry.name)) {
    best = Math.max(best, 92)
    reason = 'alias'
  }

  // Token overlap on filler-stripped tokens.
  const entryTokens = coreTokens(entryNormFull)
  const tokenScore = jaccard(inputTokens, entryTokens) * 80
  if (tokenScore > best) {
    best = tokenScore
    reason = 'token'
  }

  // Containment: the input is a subset of the entry's words (e.g. "highlights"
  // inside "partial highlights"). A real partial match — surfaces ambiguous
  // terms as candidates without claiming confidence.
  if (
    inputTokens.length > 0 &&
    inputTokens.every((t) => entryTokens.includes(t))
  ) {
    const coverage = inputTokens.length / entryTokens.length
    const containScore = 55 + Math.round(20 * coverage)
    if (containScore > best) {
      best = containScore
      reason = 'token'
    }
  }

  // Fuzzy distance against the entry name and its alias phrases.
  let fuzzy = fuzzyRatio(inputCore, entryCore)
  for (const phrase of aliasPhrasesForEntry) {
    fuzzy = Math.max(fuzzy, fuzzyRatio(inputCore, stripFiller(phrase)))
  }
  const fuzzyScore = fuzzy * 74
  if (fuzzyScore > best) {
    best = fuzzyScore
    reason = 'fuzzy'
  }

  return { score: Math.round(best), reason }
}

export type SuggestOptions = {
  aliases?: Record<string, string[]>
  limit?: number
  minScore?: number
}

export function suggestServices(
  input: string,
  catalog: MatchCatalogEntry[],
  options: SuggestOptions = {},
): ServiceSuggestion[] {
  const aliases = options.aliases ?? SERVICE_ALIASES
  const limit = options.limit ?? 5
  const minScore = options.minScore ?? MIN_SCORE

  const inputNormFull = normalizeServiceName(input)
  if (!inputNormFull) return []
  const inputCore = stripFiller(inputNormFull)
  const inputTokens = coreTokens(inputNormFull)
  const aliasIndex = buildAliasIndex(aliases)

  const normalizedAliasPhrases = new Map<string, string[]>()
  for (const [canonical, phrases] of Object.entries(aliases)) {
    normalizedAliasPhrases.set(
      canonical,
      phrases.map((p) => normalizeServiceName(p)),
    )
  }

  const scored = catalog
    .map((entry) => {
      const { score, reason } = scoreEntry(
        inputNormFull,
        inputCore,
        inputTokens,
        entry,
        aliasIndex,
        normalizedAliasPhrases.get(entry.name) ?? [],
      )
      return { entry, score, reason }
    })
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
}

// Top suggestion, or null if nothing clears the floor.
export function bestServiceMatch(
  input: string,
  catalog: MatchCatalogEntry[],
  options: SuggestOptions = {},
): ServiceSuggestion | null {
  return suggestServices(input, catalog, { ...options, limit: 1 })[0] ?? null
}

export function isConfident(suggestion: ServiceSuggestion | null | undefined): boolean {
  return !!suggestion && suggestion.score >= CONFIDENT_SCORE
}
