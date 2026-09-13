-- What each service DOES — the consult's diagnostic facts, as DATA.
--
-- 🔴 These live in the DATABASE and the ADMIN owns them (Tori, 2026-09-13).
-- This file is a STARTING POINT, not a source of truth: it fills a fact only
-- where nobody has set one yet, so running it again never overwrites an edit
-- made from the admin dashboard. Change a value in the dashboard and it stays
-- changed, through every future run of this file and every deploy.
--
-- Re-runnable:  pnpm seed:service-facts          (add -- --write to apply)
--
-- ── How to read the columns ───────────────────────────────────────────────
--   maxLiftLevels   levels of LIGHTENING. 0 = cannot lighten AT ALL. This is
--                   the single most load-bearing fact: it is what tells the
--                   consult that a level 4 cannot reach a level 9 in one
--                   visit, and that a toner can never get her there at all.
--   depositsTone    can add or change TONE (a gloss, a toner, a deposit colour)
--   isChemical      chemical work — history, patch and strand tests are live
--   changesShape    changes the cut, shape or silhouette
--   addsLength      ADDS length or density, rather than altering what is there
--   limitations     what it CANNOT achieve. The negative facts a plan must
--                   respect, and the ones a service NAME never conveys.
--
-- A row named here that does not exist yet is simply skipped, so this is safe
-- to run before or after `pnpm seed:service-catalog`.

UPDATE "Service" AS s SET
  "consultSummary" = COALESCE(s."consultSummary", v.summary),
  "maxLiftLevels"  = COALESCE(s."maxLiftLevels",  v.lift),
  "depositsTone"   = s."depositsTone" OR v.tone,
  "isChemical"     = s."isChemical"   OR v.chemical,
  "changesShape"   = s."changesShape" OR v.shape,
  "addsLength"     = s."addsLength"   OR v.length,
  "limitations"    = COALESCE(s."limitations", v.limits)
FROM (VALUES
  -- ── HAIRCUT ─────────────────────────────────────────────────────────────
  ('Cut','Shapes the hair she already has: length, weight and silhouette.',0,false,false,true,false,'Changes shape only. Cannot change colour, and cannot add length or density.'),
  ('Womens Cut & Style','A tailored cut finished with a blow-dry, so she leaves with the shape styled.',0,false,false,true,false,'Changes shape only. The finish is for the day, not a lasting texture change.'),
  ('Transformation Cut','A large change in length or silhouette, with extra chair time to get it right.',0,false,false,true,false,'Removes length; cannot add it. No colour change.'),
  ('Curly Cut','Cut dry, curl by curl, to shape natural texture as it actually falls.',0,false,false,true,false,'Shapes existing curl. Cannot create curl, loosen it, or change colour.'),
  ('Dry Cut','A cut on dry hair, no wash, so the fall of the hair is visible throughout.',0,false,false,true,false,'Changes shape only. No colour change, no added length.'),
  ('Kids Cut','A haircut for children twelve and under.',0,false,false,true,false,'Changes shape only.'),
  ('Bang Trim','A trim of the fringe alone.',0,false,false,true,false,'Touches the fringe only — not the overall length, shape or colour.'),
  -- ── BARBERING ───────────────────────────────────────────────────────────
  ('Mens Cut','A cut and shape through the sides and top.',0,false,false,true,false,'Changes shape only. No colour change, no added length.'),
  ('Cut & Beard Trim','A haircut together with a beard shape-up in one appointment.',0,false,false,true,false,'Changes shape only.'),
  ('Beard Trim','Shapes and evens the beard.',0,false,false,true,false,'Beard only — does not touch the hair on the head, and no colour change.'),
  ('Military Cut','A short, regulation-length cut.',0,false,false,true,false,'Changes shape only.'),
  ('Student Cut','A standard cut at a student rate.',0,false,false,true,false,'Changes shape only.'),
  ('Skin Fade','A clipper fade taken down to the skin and blended up into the length on top.',0,false,false,true,false,'Removes length at the sides. Cannot add length or change colour.'),
  ('Taper','A gradual fade at the neckline and sideburns only.',0,false,false,true,false,'Touches the perimeter only, not the overall length.'),
  ('Straight Razor Fade','A fade finished with a straight razor for the sharpest blend and edges.',0,false,false,true,false,'Changes shape only.'),
  ('Buzz Cut','One clipper length all over.',0,false,false,true,false,'Removes nearly all length, and cannot be undone in the chair.'),
  ('Head Shave','Takes the head down to the skin with a razor or clippers.',0,false,false,true,false,'Removes all length. Irreversible in the appointment.'),
  ('Line Up','Sharpens the hairline and edges.',0,false,false,true,false,'Edges only — no change to length, shape or colour.'),
  ('Beard Sculpt','Shapes the beard to the face, with defined edges.',0,false,false,true,false,'Beard only.'),
  ('Hot Towel Shave','A traditional wet shave with hot towels.',0,false,false,true,false,'Removes facial hair. Does not touch the hair on the head.'),
  -- ── HAIR COLOUR ─────────────────────────────────────────────────────────
  -- 🔴 maxLiftLevels is the fact that decides whether a goal is reachable in
  -- one visit. Deposit-only services are 0 and must stay 0.
  ('Full Head Highlight','Lightened pieces woven throughout the whole head for overall brightness.',4,true,true,false,false,'Lightens pieces, not the base between them. Very dark or previously coloured hair may need more than one visit to reach a pale blonde.'),
  ('Partial Highlight','Lightened pieces through the top and sides, where the light hits.',4,true,true,false,false,'Covers the top and face-framing sections only — the back and under-sections are left as they are.'),
  ('Root touch up','Covers regrowth at the root, matched to the existing colour.',1,true,true,false,false,'Treats the regrowth only. Does not brighten or change the lengths and ends.'),
  ('Toner','Adjusts and refines tone — takes brassiness down, evens the result.',0,true,true,false,false,'Cannot lighten hair by even one level. It only changes the tone of what is already there, so it can never reach a lighter goal on its own.'),
  ('Balayage','Hand-painted lightness placed to grow out softly, without a hard regrowth line.',5,true,true,false,false,'Lightens the painted pieces only. A very dark base may need more than one session to reach a pale result.'),
  ('Partial Balayage','Hand-painted lightness through the top and face-framing sections.',5,true,true,false,false,'The back and under-sections are left as they are.'),
  ('Babylights','Very fine, closely placed highlights for a soft, natural brightness.',4,true,true,false,false,'Subtle by design — will not produce a bold or high-contrast result.'),
  ('Money Piece','Bright face-framing pieces at the front hairline.',5,true,true,false,false,'Treats the front hairline only, not the rest of the head.'),
  ('Lowlights','Darker pieces woven in to restore depth and dimension.',0,true,true,false,false,'Adds depth — it darkens. Cannot lighten anything.'),
  ('All-Over Color','One colour from root to end, in a single process.',1,true,true,false,false,'A single-process colour cannot meaningfully lighten hair that is already coloured. Going lighter than the existing colour needs a lightening service.'),
  ('Gloss','A semi-permanent glaze that refreshes tone and adds shine between colour visits.',0,true,true,false,false,'Deposits tone and shine only. Cannot lighten, and cannot cover grey reliably.'),
  ('Bleach & Tone','A full lightening to blonde, followed by a toner — a double process.',7,true,true,false,false,'The strongest lightening on the menu. Condition and colour history set the realistic limit, and a very dark or previously coloured base may still need more than one session.'),
  ('Bleach Root Retouch','Lightens the new regrowth to match previously lightened lengths.',7,true,true,false,false,'Treats the regrowth only. Does not refresh or change the lengths and ends.'),
  ('Color Melt','Blends two or more shades so the colour transitions with no visible line.',0,true,true,false,false,'A blending technique — it does not lighten. It needs lightened hair to blend into.'),
  ('Root Smudge','Softens a hard regrowth line so colour grows out gently.',0,true,true,false,false,'Softens the root only. Cannot lighten.'),
  ('Grey Blending','Softens grey into the surrounding colour rather than covering it solidly.',1,true,true,false,false,'Blends rather than covers — it will not give full, opaque grey coverage.'),
  ('Vivid Color','Bold fashion shades — the blues, pinks, reds and purples.',0,true,true,false,false,'Deposits colour only. Nearly always needs the hair lightened FIRST, so on dark hair it is a second service and not a standalone one.'),
  ('Color Correction','Repairs and rebalances previous colour that has gone wrong — banding, uneven tone, an unwanted result.',5,true,true,false,false,'Scope cannot be judged from a photograph. Needs the professional to assess in person, and very often takes more than one appointment.'),
  ('Color Consultation','A sit-down with the professional to assess hair and agree a colour plan.',0,false,false,false,false,'No colour is applied and nothing about the hair changes at this appointment.'),
  ('Patch Test','A small skin test before colour, to check for a reaction.',0,false,false,false,false,'A safety prerequisite, not a treatment. Nothing about the hair changes, and it must happen far enough ahead of the colour appointment to be read.'),
  ('Strand Test','A test piece processed to see how the hair actually behaves before committing.',0,false,false,false,false,'A safety and feasibility check, not a treatment. It changes one small section only.'),
  -- ── EXTENSIONS ──────────────────────────────────────────────────────────
  ('iTip install','Individual strands attached with small beaded tips, for added length and fullness.',0,false,false,false,true,'Adds length and density. Does not change the colour of her own hair — matching the extensions to her colour may need a separate colour service.'),
  ('iTip Maintenance','Moves grown-out iTip strands back up to the root.',0,false,false,false,true,'Maintains an existing install. Not a first fitting, and adds no new hair.'),
  ('Tape-In Install','Pre-taped wefts fitted in thin sections, for length and fullness.',0,false,false,false,true,'Adds length and density. Does not change her own colour.'),
  ('Tape-In Move-Up','Removes, re-tapes and refits existing tape-in wefts as they grow out.',0,false,false,false,true,'Maintains an existing install; no new hair is added.'),
  ('Hand-Tied Weft Install','Fine hand-tied wefts sewn onto beaded rows, lying flat for length and fullness.',0,false,false,false,true,'Adds length and density. Does not change her own colour.'),
  ('Hand-Tied Weft Move-Up','Lifts and re-sews existing hand-tied rows as they grow out.',0,false,false,false,true,'Maintains an existing install; no new hair is added.'),
  ('K-Tip Install','Keratin-bonded strands fused individually for length and fullness.',0,false,false,false,true,'Adds length and density. Does not change her own colour.'),
  ('Sew-In Install','Wefts sewn onto braided cornrow foundations.',0,false,false,false,true,'Adds length and density. Does not change her own colour.'),
  ('Extension Removal','Takes existing extensions out safely.',0,false,false,false,false,'Removal only — nothing new is fitted, and it does not restore hair condition on its own.'),
  ('Extension Cut & Blend','Cuts and blends fitted extensions into her own hair so the join is invisible.',0,false,false,true,false,'Finishes an install. Not a standalone haircut and not a fitting.'),
  ('Extensions Consultation','A sit-down to assess suitability, match colour and plan an install.',0,false,false,false,false,'Nothing is fitted at this appointment.'),
  -- ── TREATMENTS ──────────────────────────────────────────────────────────
  ('Deep Conditioning Treatment','An intensive conditioning treatment for softness and moisture.',0,false,false,false,false,'Improves condition and feel. Does not change colour, shape or curl pattern.'),
  ('Bond Repair Treatment','Rebuilds the internal bonds in hair stressed by lightening or heat.',0,false,false,false,false,'Improves strength and condition. Does not change colour, and cannot reverse breakage that has already happened.'),
  ('Scalp Treatment','A cleansing, balancing treatment for the scalp itself.',0,false,false,false,false,'Treats the scalp, not the hair. Cosmetic only — not a treatment for a medical scalp condition.'),
  ('Detox Treatment','A clarifying treatment that lifts product, mineral and chlorine build-up.',0,false,false,false,false,'Removes build-up only. Not a colour remover and not a lightening service.'),
  ('Keratin Smoothing Treatment','A smoothing treatment that relaxes frizz and cuts blow-dry time.',0,true,false,false,false,'Smooths and loosens texture for a period of months; it is not permanent, does not straighten completely, and changes no colour. Chemical work — history matters.'),
  ('Relaxer','Permanently loosens or straightens natural curl pattern.',0,false,true,false,false,'Permanent and irreversible — the treated hair will not return to its natural curl. Changes no colour. Chemical work with real history and compatibility limits.'),
  ('Relaxer Retouch','Relaxes the new natural regrowth only, matching previously relaxed lengths.',0,false,true,false,false,'Treats the regrowth only. Overlapping onto previously relaxed hair risks breakage.'),
  ('Perm','Chemically adds curl or wave to straight hair.',0,false,true,false,false,'Permanent. Cannot be undone in the chair, and changes no colour.'),
  -- ── STYLING ─────────────────────────────────────────────────────────────
  ('Blowout','A wash and blow-dry into a smooth, finished shape.',0,false,false,false,false,'Lasts until the next wash. Changes nothing about the cut, colour or texture.'),
  ('Silk Press','Textured hair pressed smooth and straight, with heat alone.',0,false,false,false,false,'Temporary — reverts with water or humidity. It is not a relaxer and makes no permanent change.'),
  ('Roller Set','Set on rollers and dried into soft, uniform waves or curl.',0,false,false,false,false,'Temporary, and lasts until the next wash.'),
  ('Curly Wash & Go','Natural curl washed, defined and dried in its own pattern.',0,false,false,false,false,'Temporary styling of existing curl. Cannot create or loosen a curl pattern.'),
  ('Updo','Hair dressed and pinned up for an occasion.',0,false,false,false,false,'Styling for the day only.'),
  ('Event Styling','Styling for a specific occasion.',0,false,false,false,false,'Styling for the day only.'),
  ('Bridal Hair','Wedding-day styling, usually with a trial beforehand.',0,false,false,false,false,'Styling for the day only.'),
  ('Bridal Hair Trial','A rehearsal of the wedding-day look, ahead of the date.',0,false,false,false,false,'A rehearsal, not the wedding-day appointment itself.'),
  ('Iron Finish','A curl or wave put in with an iron.',0,false,false,false,false,'Temporary — lasts until the next wash.'),
  -- ── BRAIDING ────────────────────────────────────────────────────────────
  ('Box Braids','Individual braids on square sections, usually with added hair.',0,false,false,false,true,'A protective style. Adds length where hair is added; changes no natural colour.'),
  ('Knotless Braids','Box braids started without a knot, so the root sits flatter with less tension.',0,false,false,false,true,'A protective style. Changes no natural colour.'),
  ('Cornrows','Braids worked flat to the scalp in rows.',0,false,false,false,false,'A protective style. Changes no natural colour.'),
  ('Feed-In Braids','Cornrows with hair fed in gradually for length and thickness.',0,false,false,false,true,'A protective style. Changes no natural colour.'),
  ('Two-Strand Twists','Hair twisted in two strands, worn as a style or as a set.',0,false,false,false,false,'A protective style. Changes no natural colour.'),
  ('Starter Locs','Begins the locking process, in coils, twists or braids.',0,false,false,false,false,'The start of a long-term commitment — locs cannot be undone later without cutting.'),
  ('Loc Retwist','Retwists grown-out roots to maintain existing locs.',0,false,false,false,false,'Maintains existing locs. Does not start them.'),
  ('Braid Takedown','Takes an existing braid style down safely.',0,false,false,true,false,'Removal only. Nothing new is installed, and it is not a wash or a treatment.')
) AS v(name, summary, lift, tone, chemical, shape, length, limits)
WHERE s.name = v.name;
