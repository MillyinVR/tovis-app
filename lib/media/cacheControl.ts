// lib/media/cacheControl.ts
//
// The `cache-control` value every upload in this repo writes onto its object.
//
// 🔴 Why this file exists: we were not sending one at all, so the stored value
// was whatever Supabase's storage-api happened to default to — and that default
// changed under us. Measured in production 2026-09-02 (`storage.objects.metadata
// ->>'cacheControl'`):
//
//     max-age=undefined    48 objects, none created after 2026-06-13
//     no-cache            176 objects, none created before 2026-06-14
//     max-age=3600        193 objects — the storage-js SDK default, from the
//                         server-side copy path, which DID send a value
//
// Nothing in this repo ever asked for any of those three. Two of them are an
// accident of which month the upload happened in, and the third only differs
// because that one call site went through the SDK.
//
// ⚠️ Be precise about what is and is not broken. `max-age=undefined` is a
// malformed header, but it is NOT reaching anyone: checked against production on
// two of those very objects, on a cache MISS and on a REVALIDATE, the origin
// serves `no-cache` regardless of what the metadata stores. storage-api
// normalises the unparseable value at serve time. So there is nothing to
// back-fill and no live exposure from it — the defect is that the value is not
// ours, and has already moved twice without us noticing.
//
// ── Why `no-cache` ───────────────────────────────────────────────────────────
//
// This governs the BROWSER only, and it is what production already serves today,
// so stating it changes no observable behaviour — it only stops the value being
// the platform's to change.
//
// It costs nothing at the edge. Measured, not assumed (A/B against production,
// 2026-09-02): an object stored `no-cache` and one stored `max-age=3600` were
// both served `cf-cache-status: HIT` from the very next request, and both
// stopped resolving at the same moment after deletion. Supabase's Smart CDN
// caches at the edge for as long as it can and revalidates from asset metadata,
// independently of this header.
//
// What it buys:
//
//   1. Retraction reaches the browser. `retractMediaAssetToPrivate` deletes the
//      public object and purges the edge so the URL stops resolving; a browser
//      holding a long `max-age` copy would keep rendering the withdrawn
//      photograph anyway, and nothing can reach into it.
//   2. Stable-path overwrites stay correct. Avatars and service images upload
//      with `upsert: true` to a fixed path (`current.<ext>`), so a fresh upload
//      must be visible immediately — a max-age would leave the old image on
//      screen for its whole window.
//
// ⚠️ If a future change wants real browser caching for immutable look imagery
// (the feed still ships full-size originals), that belongs on the render URLs,
// which carry their own query string per transform — NOT on the stored object.
// An object at a content-addressed path is still deletable, and retraction has
// to win.
export const MEDIA_UPLOAD_CACHE_CONTROL = 'no-cache'
