// lib/locale.ts
//
// The app's display locale — the single source of truth for every `Intl`
// formatter that produces something a person reads.
//
// WHY THIS EXISTS. `lib/time` already forces an explicit `timeZone` on every
// date formatter, so an appointment can never silently render in the server's
// zone. The locale is the same axis and had no such rule: passing `undefined`
// (or omitting the argument) hands `Intl` the RUNTIME's default locale —
// `LANG`/`LC_ALL` on the server, the VISITOR's browser locale in the client
// bundle. Measured on `origin/main`, driven in a real browser with a clean
// null control: an `en-GB` visitor was served "Wed 8 Jul, 13:00" where a US
// one saw "Wed, Jul 8, 1:00 PM", and a `fr-FR` visitor got
// "◆ dim. 16 août · All locations" — a French date inside an English sentence,
// on a pro's own calendar.
//
// The product is written in English end to end: every string, every brand
// token, every notification. A viewer-localised date inside that copy is not
// internationalisation, it is one half of a translation. So the locale is
// pinned here, once, and the formatters default to it.
//
// ⚠️ WHITE-LABEL SEAM — this is deliberately NOT `BrandConfig.locale`.
// A per-tenant locale has to reach all 128 display call sites to be honest,
// and a `lib/time` formatter is a plain synchronous function: it is called
// from jobs, notification delivery and exports that hold no tenant context,
// and from client components that cannot await one. Wiring only the surfaces
// that *can* resolve a tenant would give a tenant British dates on a dozen
// screens and American ones on the rest — a control that looks authoritative
// and renders an inconsistent app. Threading a locale beside the `timeZone`
// argument the way this repo already threads scheduling truth is the real
// shape of that work, and it is a programme, not a constant.
//
// Until that decision is made, everything reads from here.
export const DISPLAY_LOCALE = 'en-US'
