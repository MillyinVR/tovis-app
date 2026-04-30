# Tovis App — UI Audit Report

**Date:** April 28, 2026
**Audited by:** Design Taste Skills (taste-skill, redesign-skill, minimalist-skill, soft-skill, brandkit, stitch-skill)
**Scope:** Full codebase UI review — no changes made
**Target:** Tech-luxury aesthetic (not spa/salon), gender-neutral, responsive across mobile/tablet/desktop

---

## Tech Stack Summary

- **Framework:** Next.js 16 (App Router, React 19, Server Components + Client Components)
- **Styling:** Tailwind CSS v4 + custom CSS design tokens via CSS custom properties
- **Fonts:** Inter Tight (body), Fraunces (display/serif), JetBrains Mono (mono)
- **Icons:** Lucide React
- **Motion:** Framer Motion installed but barely used (only 3 files)
- **Design tokens:** Comprehensive CSS variable system in `brand.css` — semantic color tokens, radii, shadows, glass effects
- **Architecture:** Role-based layouts (Pro, Client, Admin, Guest) with a portal-based footer system

---

## What's Already Good

These are genuine strengths that many apps at this stage don't have. Protect these.

**1. The design token system is excellent.** Your `brand.css` is one of the strongest things in this codebase. Semantic naming (`--bg-primary`, `--text-secondary`, `--accent-primary`), no raw hex leaking into components, and everything flows from a single source of truth. This is how premium products are built. The prototype aliases (`--ink`, `--paper`, `--terra`) show you're thinking about the brand language, not just colors.

**2. The warm dark palette is distinctive.** The espresso-toned dark mode (`10 9 7` for bg-primary, `20 17 14` for bg-secondary) avoids the generic "dark gray SaaS" look. The warm terra accent (`224 90 40`) is bold without being garish. This is not the typical purple/blue AI gradient — it has genuine character.

**3. The serif + sans pairing works.** Fraunces for display headlines with Inter Tight for body creates a real editorial tension. The italic serif headlines on the Looks feed overlays, profile names, and auth headers give it personality. This font pairing says "curated" not "corporate."

**4. The glass and surface system is thoughtful.** You have distinct surface tiers (`.tovis-glass`, `.brand-glass`, `.brand-card`, `.brand-surface`) with considered opacity, blur, and border values. The inner highlight on glass elements (`shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`) shows attention to light physics.

**5. The Looks feed is architecturally strong.** Full-viewport scroll-snap, IntersectionObserver for active slide tracking (not `window.addEventListener('scroll')`), proper abort controller management, optimistic like updates with rollback — this is solid engineering. The right action rail with the floating BOOK button is a clear primary CTA.

**6. Viewport handling is correct.** You're using `100dvh` and `min-h-dvh` consistently instead of the broken `100vh`/`h-screen`. The `min-h-screen` usage is limited to static pages where it's harmless. `env(safe-area-inset-*)` is handled throughout for notch/home-indicator spacing. This is mobile-first thinking.

**7. The auth shell has premium touches.** The radial gradient vignette, the wordmark with the micro-accent divider (the diamond dot between two lines), the glass card with top highlight edge — these are the small details that make auth feel considered rather than generic.

**8. Reduced motion is respected.** Both `globals.css` and `brand.css` have proper `prefers-reduced-motion: reduce` media queries. This is an accessibility requirement many apps skip entirely.

**9. Focus rings use the brand accent.** The `:focus-visible` ring uses a double-ring technique with the accent color. It's visible and branded rather than the browser default blue outline.

**10. The section label pattern (`.tovis-section-label`) is elegant.** The mono caps text with the extending hairline — this is an editorial design convention, not a generic UI pattern. It signals "curated publication" rather than "SaaS dashboard."

---

## What Needs Improvement

Organized by impact — highest visual improvement per effort at the top.

---

### 1. Typography Hierarchy Needs Tightening

**Problem:** The type scale is inconsistent across pages. The hero uses `text-[52px]` scaling to `text-[96px]` which is excellent, but the rest of the app lives almost entirely at `text-[12px]` to `text-[14px]`. There's a missing middle tier. Pro bookings page headers are `text-[22px]`, client home greeting is `text-[32px]`, and section titles jump around between `text-[15px]` and `text-[26px]`.

**Impact:** Without a locked type scale, the app feels like it was built by different people on different days. Premium products have a strict, auditable type ramp.

**Recommendation:**
- Define a 7-step type scale in your tokens: `--text-xs` (10px), `--text-sm` (12px), `--text-base` (14px), `--text-lg` (16px), `--text-xl` (20px), `--text-2xl` (28px), `--text-display` (48px+).
- Every text element should map to one of these. No arbitrary `text-[13px]` or `text-[11px]` one-offs.
- Use `clamp()` for responsive display text: `font-size: clamp(2.5rem, 5vw + 1rem, 6rem)` instead of breakpoint-specific sizes.

---

### 2. Motion Is Almost Entirely Missing

**Problem:** Framer Motion is installed and imported in only 3 files (admin service grid, pro overlay, pro add-service). The entire client-facing experience — feed scrolling, page transitions, card appearances, drawer openings, state changes — is essentially static. The one animation in `brand.css` (`brand-slide-up`) is a basic 220ms ease-out. The skill standards expect spring physics, staggered reveals, scroll-driven entries, and perpetual micro-interactions at minimum.

**Impact:** This is the single biggest gap between "functional app" and "tech-luxury product." Motion is what makes an interface feel expensive. Without it, everything mounts instantly and feels flat.

**Recommendation (priority order):**
- **Page entry animations:** Every section should fade-translate in on mount. Use `translateY(16px) + opacity: 0` resolving over 500-600ms with a custom cubic-bezier (`0.16, 1, 0.3, 1`). Apply via IntersectionObserver.
- **Staggered list reveals:** The bookings list, feed overlays, filter pills, nav items — stagger them with `animation-delay: calc(var(--index) * 80ms)`.
- **Spring physics for interactions:** The `.active:scale-[0.98]` on buttons is good but linear. Replace with Framer Motion's spring config (`stiffness: 200, damping: 24`) for a weighted, physical feel.
- **Sheet/drawer transitions:** The comments drawer and availability drawer should slide + fade with spring motion, not instant mount.
- **Feed slide transitions:** Add a subtle parallax shift or scale transition as cards snap into view.

---

### 3. The Looks Feed Overlays Need Refinement for Gender Neutrality

**Problem:** The copy signals lean feminine — "A New Age of Self Care," "glow-ups," "Future-you called. Do it," "Main-character upgrade," "Low-maintenance glow." While these resonate with one segment, they may alienate men or anyone who doesn't identify with beauty/wellness vocabulary. The booking signals ("Filling fast," "Popular near you") are neutral and strong.

**Impact:** You specifically said both men and women should feel comfortable scrolling the feed. The visual design is actually quite gender-neutral (the warm espresso palette, the editorial serif, the terra accent — none of these read as gendered). But the copy undermines that.

**Recommendation:**
- Replace "A New Age of Self Care" with something like "Your look. Your terms." or "Find your style."
- Rework `FUTURE_SELF_LINES` to be confidence-oriented rather than beauty-oriented: "Confidence starts here," "Sharp look, zero effort," "Upgrade your routine," "Look the part."
- "Glow-up" is fine in context but avoid it as the only metaphor. Mix in "transformation," "fresh cut," "new style."
- The `BOOKING_SIGNALS` array is already great — keep those as-is.

---

### 4. Card Overuse and Surface Flatness

**Problem:** The pro bookings page, client home, and profile pages wrap nearly everything in bordered cards (`.tovis-glass`, `border border-white/10`, `.brand-profile-service-card`, etc.). When every element has the same card treatment, nothing has hierarchy. The cards all use the same border (`surface-glass / 0.16`), same radius (`--radius-card: 14px`), and same background. They're functionally identical boxes.

**Impact:** Per the taste-skill rules: "Cards should exist only when elevation communicates hierarchy." When everything is a card, nothing is elevated.

**Recommendation:**
- **Remove card borders from list items.** Booking rows, service items, and review cards should use `border-bottom` dividers or pure spacing instead of full card wrappers. Reserve the full card treatment for the primary content block (the upcoming appointment, the featured service).
- **Vary the surface treatment.** Your token system already supports this — use `--bg-secondary` for grouped containers, and only add the glass border to the one thing that should pop.
- **Introduce a "featured" elevation tier.** One card per section gets a slightly stronger shadow and a micro-accent border-top (1px of `--accent-primary` at 20% opacity). Everything else is flat.

---

### 5. Lucide Icons Are the Default AI Choice

**Problem:** You're using `lucide-react` throughout — `Heart`, `MessageCircle`, `Bookmark`, `Upload`, `CalendarDays`, `Search`, `X`, `Compass`, `House`, `LogIn`, etc. Per every taste skill audited: Lucide/Feather is the "most common AI icon choice" and is explicitly flagged as generic.

**Impact:** Icons are one of the fastest tells of whether a product was AI-scaffolded or hand-designed. Lucide at default stroke width reads as template-tier.

**Recommendation:**
- Migrate to **Phosphor Icons** (`@phosphor-icons/react`) with the **Light** or **Thin** weight for a more refined, distinctive look. Phosphor has the same coverage as Lucide but with more weight options and a less ubiquitous feel.
- Alternatively, if the Lucide set is kept, standardize all icons to `strokeWidth={1.5}` (thinner than the default 2) and ensure consistent sizing across contexts.
- The custom SVG bell icon on the client home header is actually better than using Lucide — more of that approach would differentiate the app.

---

### 6. The Footer Navigation Needs Desktop Adaptation

**Problem:** The bottom tab bar (ClientSessionFooter, ProSessionFooter, GuestSessionFooter) is always a mobile-style bottom bar. On desktop viewports, a bottom tab bar with icons is not the expected pattern — it wastes vertical space and feels like a phone app running in a browser window. The footer is fixed at `z-index: 999999` and always present.

**Impact:** On desktop and tablet landscape, this creates a cramped, mobile-only impression. Tech-luxury products (Linear, Vercel, Raycast) use top navigation or a sidebar on desktop and only show bottom tabs on mobile.

**Recommendation:**
- **Below `md` (768px):** Keep the current bottom tab bar. It's well-built for mobile.
- **At `md` and above:** Transform to either a slim top navigation bar or a collapsible left sidebar. The center "Looks" button (the 68px raised circle) could become a prominent top-bar element or command-menu trigger on desktop.
- At minimum, constrain the footer's max-width to something sensible on large screens (you already have `max-w-140` which is good) and add more visual separation from the content area.

---

### 7. Inline Styles Versus Token System

**Problem:** There's a significant split between components that use the design token system and components that use inline `style={{}}` with hardcoded values. The `LookOverlays`, `RightActionRail`, `LooksTopBar`, and `FooterNavItem` components are full of raw values: `'rgba(244,239,231,1)'`, `'#E05A28'`, `'rgba(10,9,7,0.80)'`, `'rgba(20,17,14,0.65)'`. Meanwhile, the brand CSS and AuthShell use tokens religiously.

**Impact:** This makes the design system unreliable. If you want to adjust the palette (e.g., for a lighter mode, a seasonal theme, or white-labeling), half the app will respond and half won't.

**Recommendation:**
- Every hardcoded `'rgba(244,239,231,...)'` should become `rgb(var(--text-primary) / ...)`.
- Every `'#E05A28'` should become `rgb(var(--accent-primary))`.
- The `PAPER`, `EMBER`, `ACID` constants in `RightActionRail.tsx` and `LookOverlays.tsx` should reference CSS variables, not hex values.
- This is a mechanical refactor with zero visual change, but it unlocks theming and white-labeling.

---

### 8. Loading and Empty States Are Minimal

**Problem:** Loading state in the Looks feed is a plain text `"Loading Looks…"`. Empty state is `"No Looks yet. This is where the glow-ups will live."` The pro bookings empty state is `"No bookings here yet."` in a basic card. There are no skeleton loaders anywhere.

**Impact:** Per the redesign skill: "An empty dashboard showing nothing is a missed opportunity. Design a composed 'getting started' view." And "Replace generic circular spinners with skeleton loaders that match the layout shape."

**Recommendation:**
- **Skeleton loaders for the feed:** 3-4 full-viewport placeholder cards with a shimmer animation matching the LookSlide layout shape (dark rectangle with gradient-bottom zone and right-rail circle placeholders).
- **Composed empty states:** The empty feed should show a large illustration or branded graphic with a single-line message and a CTA. Something like a minimal line drawing of a camera with "Be the first to post a look."
- **Pro bookings empty:** Instead of a text card, show a subtle illustration with "Your day is clear. Time for a coffee."

---

### 9. The Hero Landing Page Uses a Centered Layout at High Variance

**Problem:** The home page hero is actually *left-aligned* which is great — but the hero section occupies the full viewport with no visual content on the right side. It's pure text + atmospheric glows. There's no imagery, no product preview, no screenshot, no portfolio sample. For a visual product about beauty/style, this is a missed opportunity.

**Impact:** The taste-skill says: "Stop doing centered text over a dark image. Try asymmetric Hero sections." You've got the asymmetry, but there's nothing balancing the composition on the media side.

**Recommendation:**
- Add a floating device mockup or portfolio grid on the right half of the hero at `md` and above. Show what the Looks feed actually looks like — a phone frame with a sample look, or a 2x2 grid of look thumbnails.
- On mobile, this collapses below the text. On desktop, it creates the asymmetric split-screen hero that signals "real product" rather than "coming soon."
- The atmospheric glows are good — layer the mockup on top of them for depth.

---

### 10. Responsive Design Gaps

**Problem areas identified:**

**a) Client home shell uses `-mx-4 w-screen` as a breakout hack.** This is fragile and can cause horizontal scroll on some viewports. At `md:mx-0 md:w-full` it resets, but the mobile breakout should use a proper full-bleed pattern.

**b) No tablet-specific breakpoint treatment.** The app jumps from single-column (mobile) to 2-column (`md:grid-cols-2`) with nothing in between. On a 768-1024px tablet in portrait, the 2-column layout can feel cramped.

**c) The Looks feed's `max-w-560px` container creates dead space on desktop.** The side fade gradients (`w-[12vw]`) help, but on a 1440px+ screen, most of the viewport is empty dark space with the feed as a narrow column.

**d) Touch targets on the tab pills.** Filter pills on the pro bookings page are `px-4 py-2 text-[12px]` — the vertical touch target is ~32px, under the 44px minimum recommended for mobile.

**Recommendation:**
- Add a `lg` breakpoint treatment for the feed that shows a sidebar (pro info, comments, related looks) flanking the media column.
- Increase all pill/chip touch targets to minimum 44px height on mobile.
- Replace the `-mx-4 w-screen` hack with a proper container-breakout utility.
- Add an `sm` (640px) intermediate layout for tablet portrait.

---

### 11. Text Shadow Dependency on the Feed

**Problem:** The Looks feed overlays rely entirely on `text-shadow: 0 2px 20px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.9)` for legibility. This is fine for photos with depth, but on light-colored or washed-out media, the text will be hard to read even with shadow.

**Recommendation:**
- Add a scrim/gradient behind the text overlay area (you already have a bottom fade for the footer area, but the left-side caption zone has no backing).
- Consider a frosted-glass pill behind the pro name and service label instead of relying on shadow alone.

---

### 12. The `z-index: 999999` on the Footer Host Is Excessive

**Problem:** `footerHostStyle` in the root layout sets `zIndex: 999999`. This will collide with third-party tools (intercom, analytics widgets, cookie banners) and makes debugging layer issues painful.

**Recommendation:** Establish a z-index scale: `--z-footer: 100`, `--z-drawer: 200`, `--z-modal: 300`, `--z-overlay: 400`. The footer should be the lowest fixed layer, not the highest.

---

## Tech-Luxury Upgrade Priorities

If you want to push toward "tech luxury" (think Linear, Arc, Amie, Raycast — not salon or spa), here's the priority stack:

**Tier 1 — Do These First (biggest impact, lowest risk):**
1. Add page-entry and stagger animations (CSS-only, no library needed)
2. Replace Lucide with Phosphor Light icons
3. Lock the type scale to 7 steps and enforce it globally
4. Refactor inline hardcoded colors to CSS variable references

**Tier 2 — Do These Next (medium effort, high polish):**
5. Build skeleton loaders for feed and bookings
6. Add spring physics to button/card interactions via Framer Motion
7. Reduce card overuse — switch to dividers and spacing for lists
8. Add a hero media element (device mockup or portfolio preview)

**Tier 3 — Do These for the Full Premium Feel:**
9. Desktop navigation transformation (bottom tabs → top bar or sidebar)
10. Tablet-specific breakpoints and feed sidebar on wide screens
11. Composed empty states with illustrations
12. Grain/noise texture overlay on fixed layer for the feed background

---

## Summary

Tovis has a genuinely strong foundation — the token system, the warm palette, the serif/sans pairing, and the mobile-first viewport handling are all well above average. The app's *structure* is premium; what's missing is the *motion and polish* that makes it *feel* premium. The biggest single upgrade is adding animation: page entries, staggered reveals, and spring physics on interactions. That alone would shift the perception from "functional MVP" to "this was designed with intention."

The gender-neutrality goal is mostly achieved through the visual design — the warm espresso palette and editorial typography are genuinely unisex. The copy needs a pass to match that neutrality.

No changes were made to the codebase. This is a read-only audit.
