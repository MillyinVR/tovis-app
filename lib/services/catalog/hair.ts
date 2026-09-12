// lib/services/catalog/hair.ts
//
// The canonical HAIR service menu: every cut, colour, extension, treatment,
// styling and braiding service the consult should be able to name.
//
// WHY THIS EXISTS. The catalog is a closed list — a pro attaches an offering to
// a `Service` row, and the consult recommends by the EXACT names on her menu
// (`menuServiceNames` → a per-run enum, lib/consult/analysisContract.ts). Prod
// held twelve hair rows (verified by SQL 2026-09-12), so the analysis could
// never say "balayage" or "gloss" or "tape-in move-up" however well it read the
// hair. This file is what the consult can now reach for.
//
// RULES FOR EDITING.
//   * The twelve rows marked `// prod` are PRODUCTION'S ROWS, spelled and
//     priced exactly as they are there. Do not rename or re-price them here:
//     the name is the unique key (a respelling creates a near-duplicate the
//     seed refuses) and the floor is enforced against every live offering.
//     The ONE deliberate move is "Cut" → Cuts (Tori, 2026-09-12; the seed
//     applies a category move only with --force, so it is a visible step).
//   * `categorySlug` is the PRIMARY category; `alsoIn` lists the other
//     categories the row is shown under — a Cut is Cuts AND Barbering without
//     being two rows. A link is browsing only; the consult reads the primary.
//   * `floorUsd` is a platform MINIMUM (see types.ts). It is deliberately set
//     at the low end of what a licensed professional charges, not at a typical
//     price — a floor that is too high refuses a real pro's real price.
//   * Names carry no brand (no Olaplex, no Brazilian Blowout). Title Case.
//   * A name must not normalise equal to another (lib/migration/serviceMatch.ts
//     `normalizeServiceName`) — the consult matches names case-insensitively.
//   * Safety rows (Patch Test, Strand Test) are DERIVED from the routing rules
//     so the two can never disagree on name or duration.

import { ConsultServiceFamily, ProfessionType } from '@prisma/client'

import { CONSULT_SAFETY_SERVICE_BOOKING_RULES } from '@/lib/consult/safetyRouting'

import {
  HAIR_BRAIDING_CATEGORY_SLUG,
  HAIR_COLOR_CATEGORY_SLUG,
  HAIR_CUTS_CATEGORY_SLUG,
  HAIR_EXTENSIONS_CATEGORY_SLUG,
  HAIR_HAIRCUT_CATEGORY_SLUG,
  HAIR_STYLING_CATEGORY_SLUG,
  HAIR_TREATMENT_CATEGORY_SLUG,
} from './slugs'
import type { CatalogCategory, CatalogService } from './types'

const HAIR_LICENCES = [
  ProfessionType.COSMETOLOGIST,
  ProfessionType.HAIRSTYLIST,
] as const

const CUT_LICENCES = [...HAIR_LICENCES, ProfessionType.BARBER] as const

const BRAID_LICENCES = [...HAIR_LICENCES, ProfessionType.HAIR_BRAIDER] as const

export const ADD_ON_GROUP_FINISH = 'Finish'
export const ADD_ON_GROUP_TREATMENT = 'Treatment'
export const ADD_ON_GROUP_COLOR = 'Color'

export const HAIR_CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  {
    slug: HAIR_HAIRCUT_CATEGORY_SLUG,
    name: 'Cuts',
    description: 'Haircuts and trims for every length and texture.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
  {
    slug: HAIR_CUTS_CATEGORY_SLUG, // prod — keeps its name
    name: 'Barbering',
    description: 'Fades, tapers, razor work, beard care and shaves.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
  {
    slug: HAIR_COLOR_CATEGORY_SLUG, // prod
    name: 'Color',
    description: 'Highlights, balayage, all-over colour, glosses, corrections and colour safety tests.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
  {
    slug: HAIR_EXTENSIONS_CATEGORY_SLUG, // prod
    name: 'Extensions',
    description: 'Installs, move-ups and removals for every extension method.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
  {
    slug: HAIR_TREATMENT_CATEGORY_SLUG,
    name: 'Treatments',
    description: 'Conditioning, bond repair, scalp care, smoothing and texture services.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
  {
    slug: HAIR_STYLING_CATEGORY_SLUG,
    name: 'Styling',
    description: 'Blowouts, silk presses, sets, updos and event hair.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
  {
    slug: HAIR_BRAIDING_CATEGORY_SLUG,
    name: 'Braids & Protective Styles',
    description: 'Braids, twists, locs and takedowns.',
    parentSlug: null,
    consultFamily: ConsultServiceFamily.HAIR,
  },
]

type RowInput = Omit<
  CatalogService,
  'categorySlug' | 'alsoInCategorySlugs' | 'professions' | 'isAddOnEligible' | 'addOnGroup' | 'description'
> & {
  alsoIn?: readonly string[]
  isAddOnEligible?: boolean
  addOnGroup?: string | null
  description?: string | null
}

function rows(
  categorySlug: string,
  professions: readonly ProfessionType[],
  inputs: readonly RowInput[],
): CatalogService[] {
  return inputs.map((input) => ({
    name: input.name,
    categorySlug,
    alsoInCategorySlugs: input.alsoIn ?? [],
    defaultDurationMinutes: input.defaultDurationMinutes,
    floorUsd: input.floorUsd,
    allowMobile: input.allowMobile,
    isAddOnEligible: input.isAddOnEligible ?? false,
    addOnGroup: input.addOnGroup ?? null,
    description: input.description ?? null,
    professions,
  }))
}

function cents(priceCents: number): string {
  return (priceCents / 100).toFixed(2)
}

/**
 * The two safety tests the consult routes to, exactly as
 * lib/consult/safetyRouting.ts books them: same name, same duration, $0. The
 * analysis looks them up across the pro's WHOLE menu by exact name and refuses
 * a sensitive consult when neither is found (`ANALYSIS_PREREQUISITES_REQUIRED`),
 * so they sit in the catalog for a pro to add in one tap.
 */
export const HAIR_SAFETY_TEST_SERVICES: readonly CatalogService[] = rows(
  HAIR_COLOR_CATEGORY_SLUG,
  HAIR_LICENCES,
  [
    {
      name: CONSULT_SAFETY_SERVICE_BOOKING_RULES.PATCH_TEST.name,
      defaultDurationMinutes: CONSULT_SAFETY_SERVICE_BOOKING_RULES.PATCH_TEST.durationMinutes,
      floorUsd: cents(CONSULT_SAFETY_SERVICE_BOOKING_RULES.PATCH_TEST.priceCents),
      allowMobile: true,
      description: 'A small skin test of the product, 48 hours before any colour or chemical service, when a reaction or sensitivity has been reported.',
    },
    {
      name: CONSULT_SAFETY_SERVICE_BOOKING_RULES.STRAND_TEST.name,
      defaultDurationMinutes: CONSULT_SAFETY_SERVICE_BOOKING_RULES.STRAND_TEST.durationMinutes,
      floorUsd: cents(CONSULT_SAFETY_SERVICE_BOOKING_RULES.STRAND_TEST.priceCents),
      allowMobile: true,
      description: 'A test on a hidden section to see how your hair takes colour or lightener before the full service.',
    },
  ],
)

export const HAIR_CATALOG_SERVICES: readonly CatalogService[] = [
  // ── Cuts (salon) ─────────────────────────────────────────────────────────
  ...rows(HAIR_HAIRCUT_CATEGORY_SLUG, CUT_LICENCES, [
    { name: 'Cut', defaultDurationMinutes: 40, floorUsd: '35.00', allowMobile: true, alsoIn: [HAIR_CUTS_CATEGORY_SLUG] }, // prod — moved here from Barbering (--force)
    { name: 'Womens Cut & Style', defaultDurationMinutes: 60, floorUsd: '45.00', allowMobile: true, description: 'A tailored haircut finished with a blow-dry and style.' },
    { name: 'Transformation Cut', defaultDurationMinutes: 75, floorUsd: '55.00', allowMobile: true, description: 'A big change in length or shape — long to short, a new silhouette — with extra time to get it right.' },
    { name: 'Curly Cut', defaultDurationMinutes: 75, floorUsd: '55.00', allowMobile: true, description: 'Cut dry, curl by curl, to shape your natural texture.' },
    { name: 'Dry Cut', defaultDurationMinutes: 30, floorUsd: '30.00', allowMobile: true, description: 'A cut on dry hair, no wash or blow-dry, to see exactly how it falls.' },
    { name: 'Kids Cut', defaultDurationMinutes: 30, floorUsd: '20.00', allowMobile: true, alsoIn: [HAIR_CUTS_CATEGORY_SLUG], description: 'A haircut for children 12 and under.' },
    { name: 'Bang Trim', defaultDurationMinutes: 15, floorUsd: '10.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_FINISH, description: 'A trim of the fringe only.' },
  ]),

  // ── Barbering ────────────────────────────────────────────────────────────
  ...rows(HAIR_CUTS_CATEGORY_SLUG, CUT_LICENCES, [
    { name: 'Mens Cut', defaultDurationMinutes: 30, floorUsd: '35.00', allowMobile: true, isAddOnEligible: true, alsoIn: [HAIR_HAIRCUT_CATEGORY_SLUG] }, // prod
    { name: 'Cut & Beard Trim', defaultDurationMinutes: 50, floorUsd: '45.00', allowMobile: false }, // prod
    { name: 'Beard Trim', defaultDurationMinutes: 20, floorUsd: '20.00', allowMobile: true }, // prod
    { name: 'Military Cut', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: true }, // prod
    { name: 'Student Cut', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: true, alsoIn: [HAIR_HAIRCUT_CATEGORY_SLUG] }, // prod
    { name: 'Skin Fade', defaultDurationMinutes: 40, floorUsd: '30.00', allowMobile: true, description: 'Clipper fade taken down to the skin, blended up into the length on top.' },
    { name: 'Taper', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: true, description: 'A gradual fade at the neckline and sideburns only.' },
    { name: 'Straight Razor Fade', defaultDurationMinutes: 45, floorUsd: '35.00', allowMobile: false, description: 'A fade finished with a straight razor for the sharpest possible blend and edges.' },
    { name: 'Buzz Cut', defaultDurationMinutes: 15, floorUsd: '15.00', allowMobile: true, alsoIn: [HAIR_HAIRCUT_CATEGORY_SLUG], description: 'One clipper length all over.' },
    { name: 'Head Shave', defaultDurationMinutes: 20, floorUsd: '20.00', allowMobile: false, description: 'A razor shave of the whole head with hot towels.' },
    { name: 'Line Up', defaultDurationMinutes: 15, floorUsd: '10.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_FINISH, description: 'A clean edge-up of the hairline and neckline.' },
    { name: 'Beard Sculpt', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: true, description: 'Shaping, lining and detailing the beard with clippers and razor.' },
    { name: 'Hot Towel Shave', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: false, description: 'A traditional straight-razor shave with hot towels.' },
  ]),

  // ── Color ────────────────────────────────────────────────────────────────
  ...rows(HAIR_COLOR_CATEGORY_SLUG, HAIR_LICENCES, [
    { name: 'Full Head Highlight', defaultDurationMinutes: 120, floorUsd: '203.00', allowMobile: true }, // prod
    { name: 'Partial Highlight', defaultDurationMinutes: 75, floorUsd: '153.00', allowMobile: true }, // prod
    { name: 'Root touch up', defaultDurationMinutes: 75, floorUsd: '55.00', allowMobile: true, isAddOnEligible: true }, // prod
    { name: 'Toner', defaultDurationMinutes: 15, floorUsd: '30.00', allowMobile: true }, // prod
    { name: 'Balayage', defaultDurationMinutes: 180, floorUsd: '150.00', allowMobile: true, description: 'Hand-painted, lived-in lightness that grows out softly.' },
    { name: 'Partial Balayage', defaultDurationMinutes: 120, floorUsd: '110.00', allowMobile: true, description: 'Hand-painted lightness through the top and face-framing sections.' },
    { name: 'Babylights', defaultDurationMinutes: 180, floorUsd: '150.00', allowMobile: true, description: 'Very fine, closely placed highlights for a soft, natural brightness.' },
    { name: 'Money Piece', defaultDurationMinutes: 60, floorUsd: '50.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_COLOR, description: 'Bright face-framing pieces at the front hairline.' },
    { name: 'Lowlights', defaultDurationMinutes: 90, floorUsd: '75.00', allowMobile: true, description: 'Darker pieces woven in for depth and dimension.' },
    { name: 'All-Over Color', defaultDurationMinutes: 90, floorUsd: '65.00', allowMobile: true, description: 'One colour from root to end — a single process.' },
    { name: 'Gloss', defaultDurationMinutes: 45, floorUsd: '35.00', allowMobile: true, description: 'A semi-permanent glaze to refresh tone and add shine between colour appointments.' },
    { name: 'Bleach & Tone', defaultDurationMinutes: 180, floorUsd: '150.00', allowMobile: true, description: 'A full lightening to blonde followed by a toner — a double process.' },
    { name: 'Bleach Root Retouch', defaultDurationMinutes: 90, floorUsd: '75.00', allowMobile: true, description: 'Lightens regrowth to match an existing blonde.' },
    { name: 'Color Melt', defaultDurationMinutes: 120, floorUsd: '110.00', allowMobile: true, description: 'A seamless blend from a deeper root into lighter ends, with no visible line.' },
    { name: 'Root Smudge', defaultDurationMinutes: 30, floorUsd: '30.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_COLOR, description: 'Softens the root so highlights grow out without a line.' },
    { name: 'Grey Blending', defaultDurationMinutes: 90, floorUsd: '75.00', allowMobile: true, description: 'Blends grey into your colour rather than covering it outright, for a softer grow-out.' },
    { name: 'Vivid Color', defaultDurationMinutes: 180, floorUsd: '150.00', allowMobile: true, description: 'Fashion shades — pastels, brights and jewel tones — usually over pre-lightened hair.' },
    { name: 'Color Correction', defaultDurationMinutes: 240, floorUsd: '175.00', allowMobile: false, description: 'Fixing unwanted colour — banding, brassiness, box dye — often over more than one visit. A consultation comes first.' },
    { name: 'Color Consultation', defaultDurationMinutes: 20, floorUsd: '0.00', allowMobile: true, description: 'Talk through your goal, history and options with your colourist before booking the service.' },
  ]),
  ...HAIR_SAFETY_TEST_SERVICES,

  // ── Extensions ───────────────────────────────────────────────────────────
  ...rows(HAIR_EXTENSIONS_CATEGORY_SLUG, HAIR_LICENCES, [
    { name: 'iTip install', defaultDurationMinutes: 120, floorUsd: '300.00', allowMobile: true }, // prod
    { name: 'iTip Maintenance', defaultDurationMinutes: 60, floorUsd: '200.00', allowMobile: true }, // prod
    { name: 'Tape-In Install', defaultDurationMinutes: 90, floorUsd: '125.00', allowMobile: true, description: 'Thin wefts taped in close to the root. Hair may be priced separately.' },
    { name: 'Tape-In Move-Up', defaultDurationMinutes: 90, floorUsd: '100.00', allowMobile: true, description: 'Removes, re-tapes and re-applies your existing tape-ins at the root.' },
    { name: 'Hand-Tied Weft Install', defaultDurationMinutes: 150, floorUsd: '175.00', allowMobile: true, description: 'Hand-tied wefts sewn onto a beaded row. Hair may be priced separately.' },
    { name: 'Hand-Tied Weft Move-Up', defaultDurationMinutes: 90, floorUsd: '100.00', allowMobile: true, description: 'Moves your existing weft rows back up to the root.' },
    { name: 'K-Tip Install', defaultDurationMinutes: 180, floorUsd: '200.00', allowMobile: true, description: 'Individual keratin-bonded strands, fused at the root. Hair may be priced separately.' },
    { name: 'Sew-In Install', defaultDurationMinutes: 120, floorUsd: '90.00', allowMobile: true, description: 'Wefts sewn onto braided tracks. Hair may be priced separately.' },
    { name: 'Extension Removal', defaultDurationMinutes: 60, floorUsd: '45.00', allowMobile: true, description: 'Safe removal of any extension method, with the bonds or tape taken out of the hair.' },
    { name: 'Extension Cut & Blend', defaultDurationMinutes: 45, floorUsd: '35.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_FINISH, description: 'Cuts and blends new extensions into your own hair.' },
    { name: 'Extensions Consultation', defaultDurationMinutes: 20, floorUsd: '0.00', allowMobile: true, description: 'Colour-match, choose a method and get a quote before your install.' },
  ]),

  // ── Treatments ───────────────────────────────────────────────────────────
  ...rows(HAIR_TREATMENT_CATEGORY_SLUG, HAIR_LICENCES, [
    // ⚠️ "Deep Conditioning" is the wording `isStrandTestOptionalAddOn` matches.
    { name: 'Deep Conditioning Treatment', defaultDurationMinutes: 30, floorUsd: '20.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_TREATMENT, description: 'An intensive mask under heat to restore softness and moisture.' },
    { name: 'Bond Repair Treatment', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_TREATMENT, description: 'Rebuilds broken bonds inside the hair after colour, heat or chemical services.' },
    { name: 'Scalp Treatment', defaultDurationMinutes: 30, floorUsd: '25.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_TREATMENT, description: 'Exfoliates and soothes the scalp.' },
    { name: 'Detox Treatment', defaultDurationMinutes: 20, floorUsd: '15.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_TREATMENT, description: 'A clarifying treatment that lifts product, mineral and chlorine build-up.' },
    { name: 'Keratin Smoothing Treatment', defaultDurationMinutes: 150, floorUsd: '150.00', allowMobile: false, description: 'A smoothing treatment that reduces frizz and cuts drying time for weeks.' },
    { name: 'Relaxer', defaultDurationMinutes: 120, floorUsd: '75.00', allowMobile: false, description: 'A chemical straightening of natural texture, root to end.' },
    { name: 'Relaxer Retouch', defaultDurationMinutes: 90, floorUsd: '55.00', allowMobile: false, description: 'Relaxes the new growth only.' },
    { name: 'Perm', defaultDurationMinutes: 120, floorUsd: '75.00', allowMobile: false, description: 'A chemical wave or curl set into the hair.' },
  ]),

  // ── Styling ──────────────────────────────────────────────────────────────
  ...rows(HAIR_STYLING_CATEGORY_SLUG, HAIR_LICENCES, [
    { name: 'Blowout', defaultDurationMinutes: 45, floorUsd: '35.00', allowMobile: true, description: 'Shampoo and a smooth or bouncy blow-dry.' },
    { name: 'Silk Press', defaultDurationMinutes: 90, floorUsd: '55.00', allowMobile: true, description: 'A blow-dry and flat-iron press for a silky straight finish on natural hair.' },
    { name: 'Roller Set', defaultDurationMinutes: 60, floorUsd: '40.00', allowMobile: true, description: 'Set on rollers and dried under the dryer for lasting body.' },
    { name: 'Curly Wash & Go', defaultDurationMinutes: 60, floorUsd: '40.00', allowMobile: true, description: 'Cleansed, conditioned and styled to define your natural curl.' },
    { name: 'Updo', defaultDurationMinutes: 60, floorUsd: '55.00', allowMobile: true, description: 'A formal pinned style for an event.' },
    { name: 'Event Styling', defaultDurationMinutes: 45, floorUsd: '45.00', allowMobile: true, description: 'Waves, curls or a sleek finish for a special occasion.' },
    { name: 'Bridal Hair', defaultDurationMinutes: 90, floorUsd: '125.00', allowMobile: true, description: 'Your wedding-day style, on the day.' },
    { name: 'Bridal Hair Trial', defaultDurationMinutes: 60, floorUsd: '65.00', allowMobile: true, description: 'A run-through of your wedding style before the day.' },
    { name: 'Iron Finish', defaultDurationMinutes: 20, floorUsd: '15.00', allowMobile: true, isAddOnEligible: true, addOnGroup: ADD_ON_GROUP_FINISH, description: 'Flat-iron or curling-iron finish added to another service.' },
  ]),

  // ── Braids & Protective Styles ───────────────────────────────────────────
  ...rows(HAIR_BRAIDING_CATEGORY_SLUG, BRAID_LICENCES, [
    { name: 'Box Braids', defaultDurationMinutes: 240, floorUsd: '125.00', allowMobile: true, description: 'Individual square-parted braids. Hair may be priced separately.' },
    { name: 'Knotless Braids', defaultDurationMinutes: 300, floorUsd: '150.00', allowMobile: true, description: 'Box braids started with your own hair for a flat, tension-free root. Hair may be priced separately.' },
    { name: 'Cornrows', defaultDurationMinutes: 60, floorUsd: '45.00', allowMobile: true, description: 'Braids laid flat to the scalp in rows.' },
    { name: 'Feed-In Braids', defaultDurationMinutes: 120, floorUsd: '65.00', allowMobile: true, description: 'Cornrows with added hair fed in for a natural start and fuller braid.' },
    { name: 'Two-Strand Twists', defaultDurationMinutes: 180, floorUsd: '100.00', allowMobile: true, description: 'Twists through the whole head, with or without added hair.' },
    { name: 'Starter Locs', defaultDurationMinutes: 180, floorUsd: '125.00', allowMobile: true, description: 'Begins locs with coils, twists or braids.' },
    { name: 'Loc Retwist', defaultDurationMinutes: 90, floorUsd: '65.00', allowMobile: true, description: 'Retwists the new growth and tidies the locs.' },
    { name: 'Braid Takedown', defaultDurationMinutes: 60, floorUsd: '35.00', allowMobile: true, description: 'Removes braids or twists and detangles.' },
  ]),
]
