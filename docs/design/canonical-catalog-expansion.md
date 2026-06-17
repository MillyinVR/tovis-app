# Canonical service catalog — expansion proposal

**Status: DRAFT — needs your review (especially `min $` and licensing).**

## Why this matters (pro-ease)

The migration service-menu import matches a pro's uploaded menu against the
**canonical `Service` catalog**. The matcher is only as good as that catalog: a
service that isn't in it can't auto-match, so the pro has to hand-map it. Today
the catalog has ~7 services, so a real 30–50-service menu comes in mostly
unmatched. Expanding the catalog (+ the alias/synonym table) is the single
highest-leverage way to make import feel like magic — most of the menu just
clicks into place.

## What's in this PR

- **Seed catalog expanded** to the services below (`prisma/seed.cjs`) — this is
  the dev/reference catalog. Prod is admin-managed (`/api/admin/services`), so
  these prices are **DRAFT** and don't touch prod; apply the approved set there.
- **Alias table expanded** (`lib/migration/serviceMatch.ts`) with the competitor
  naming variants for each service, so e.g. "Shellac Mani", "Gel Polish Manicure"
  all resolve to **Gel Manicure**.

## What I need from you

1. **Minimum prices** — I drafted CA-market-ish floors; set the real platform
   minimums (this is a pricing-policy decision, not mine to finalize).
2. **Scope** — add/remove services; tell me what's missing for your launch pros.
3. **Licensing** — I mapped one `ProfessionType` per service (below); confirm,
   especially where multiple professions can perform a service.

## Proposed catalog (DRAFT)

Min $ = proposed platform minimum · Dur = default minutes · Mobile = bookable mobile · Lic = profession permitted.

### Hair — Color (cosmetologist)
| Service | Min $ | Dur | Mobile | Aliases (competitor names) |
|---|--:|--:|:-:|---|
| Balayage *(exists)* | 180 | 180 | no | balayage, babylights, ombre, hand-painted color |
| Partial Highlights | 120 | 150 | no | partial foil, half head foils, foilage |
| Full Highlights | 160 | 180 | no | full foil, full head foils |
| All-Over Color | 90 | 90 | no | single process, full color, all over color |
| Toner / Gloss | 45 | 45 | no | gloss, glaze, toner, clear gloss |
| Root Touch-Up *(exists)* | 80 | 90 | no | root retouch, color retouch, roots |

### Hair — Cut & Style (cosmetologist)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Haircut & Style *(exists)* | 65 | 60 | yes | womens cut, ladies cut, wash cut style |
| Men's Cut | 35 | 30 | yes | mens haircut, barber cut, fade, clipper cut |
| Blowout | 50 | 45 | yes | blow dry, wash and style |

### Hair — Treatment (cosmetologist)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Keratin Smoothing Treatment | 200 | 150 | no | keratin, brazilian blowout, smoothing treatment |

### Hair — Extensions (cosmetologist)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Extension Installation *(exists)* | 250 | 180 | no | tape ins, sew in, hair extensions |

### Nails (manicurist)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Gel Manicure | 45 | 60 | yes | shellac manicure, gel polish manicure |
| Classic Manicure | 30 | 45 | yes | basic manicure, manicure |
| Gel Pedicure | 55 | 60 | no | shellac pedicure |
| Acrylic Full Set | 60 | 90 | no | acrylics, acrylic set, full set acrylic |
| Dip Powder | 50 | 60 | no | sns, dip nails, powder dip |
| Gel-X Full Set *(exists)* | 100 | 120 | no | gel x, hard gel set, gel extensions |

### Lashes (esthetician)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Classic Lash Full Set | 120 | 120 | no | classic lashes, eyelash extensions full set |
| Volume Lash Full Set | 150 | 150 | no | volume lashes, russian volume |
| Lash Fill | 60 | 60 | no | lash refill, fill in |
| Lash Lift | 75 | 60 | yes | lash perm |

### Brows (esthetician)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Brow Lamination | 75 | 60 | yes | brow lam |
| Brow Wax & Shape | 25 | 20 | yes | eyebrow wax, brow shaping |

### Skin (esthetician)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Classic Facial | 90 | 60 | yes | facial, signature facial, express facial |

### Waxing (esthetician)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Brazilian Wax | 55 | 30 | no | brazilian |

### Makeup (makeup artist)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| Soft Glam Makeup *(exists)* | 120 | 75 | yes | glam makeup, event makeup |
| Bridal Makeup | 200 | 90 | yes | wedding makeup, bridal trial |

### Massage (massage therapist)
| Service | Min $ | Dur | Mobile | Aliases |
|---|--:|--:|:-:|---|
| 60-Minute Swedish Massage *(exists)* | 100 | 60 | yes | relaxation massage, full body massage |
| 60-Minute Deep Tissue | 120 | 60 | yes | deep tissue |
| Hot Stone Massage | 140 | 90 | yes | hot stone |

## Follow-ups

- The matcher's confidence threshold (`CONFIDENT_SCORE=70`) can be tuned once the
  catalog is richer.
- "Request new service → admin queue" (design spec) handles the genuine tail
  that no catalog will cover.
