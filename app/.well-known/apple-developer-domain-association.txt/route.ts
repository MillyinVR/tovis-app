// app/.well-known/apple-developer-domain-association.txt/route.ts
//
// Apple's domain-verification file for "Sign in with Apple" on the WEB. Apple
// fetches `https://<domain>/.well-known/apple-developer-domain-association.txt`
// and compares the body against the token it issued when the domain was
// registered under the Services ID. Until that fetch succeeds, Apple refuses to
// mint an identity token for the web flow, so this route is the last piece of
// Apple-on-web that is OURS — the rest (button, verifier, signup handoff) is
// already in the tree.
//
// Served from a route handler rather than `public/` so the body is sent as
// text; a `public/` file would be `application/octet-stream`.
//
// 🔴 REGISTER THE `www` HOST WITH APPLE, NOT THE APEX. Measured 2026-08-26:
// `https://tovis.me/...` and `https://tovis.app/...` answer 307 to their `www`
// host, and that redirect carries no `x-request-id` — it is a Vercel
// domain-level redirect that never reaches this app, so no route handler can
// serve the apex. Apple follows no redirect on this fetch, so an apex
// registration fails verification no matter what this file does. (The AASA
// route next door implies a handler avoids that redirect; for the apex it does
// not.) Either register `www.tovis.me` / `www.tovis.app`, or change the
// redirect in Vercel's domain settings first.
//
// The body comes from `APPLE_DOMAIN_ASSOCIATION` rather than being committed.
// That keeps the value in Tori's hands: re-doing Apple's domain verification
// (or adding a domain) becomes a config change, not a PR. ⚠️ It is still a
// DEPLOY — Vercel binds env vars at deploy time, so setting the var only takes
// effect on the next deployment, which needs Tori's go-ahead like any other.
// This ships INERT — with the var unset the route 404s, exactly as the path
// does today, so landing it changes nothing until Tori provisions.
//
// ⚠️ OPEN QUESTION, deliberately designed around rather than guessed at: Apple
// may issue ONE token per registered domain (tovis.me, tovis.app, and the `www`
// of each) rather than one for the account. Nobody here has seen the portal, so
// the var accepts BOTH shapes and the answer costs no code change:
//   - a bare token          → served for every host;
//   - a JSON object of
//     host → token          → served per host; an unlisted host 404s.
// Hosts are matched after `normalizeHost` (lowercased, port stripped), so a
// header that arrives upper-cased and with an explicit `:443` still matches a
// key written the ordinary lowercase way.

import { isRecord } from '@/lib/guards'
import { readOptionalEnv } from '@/lib/env'
import { normalizeHost } from '@/lib/tenant'

// Apple's fetch must see the value that is configured RIGHT NOW; a statically
// rendered body would freeze the token into the build. This also lets the
// per-host branch above read the request at all.
export const dynamic = 'force-dynamic'

/**
 * The host Apple actually requested, normalized. `x-forwarded-host` wins on
 * Vercel; both headers can carry a comma-separated list when proxies chain, and
 * the first entry is the outermost (client-facing) host.
 */
function requestedHost(request: Request): string | null {
  const raw =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return normalizeHost(raw?.split(',')[0])
}

/**
 * Resolve the token to serve for `host`, or null to 404.
 *
 * A value that parses to a JSON OBJECT is treated as a host→token map; anything
 * else (including a token that happens to parse as a number or a string) is the
 * literal body. Apple's tokens are opaque single-line text, so they do not parse
 * as objects and cannot be mistaken for a map.
 */
function resolveAssociation(host: string | null): string | null {
  const configured = readOptionalEnv('APPLE_DOMAIN_ASSOCIATION')
  if (configured === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(configured)
  } catch {
    return configured // the common case: one opaque token
  }

  if (!isRecord(parsed)) return configured

  if (host === null) return null
  const token = parsed[host]
  if (typeof token !== 'string') return null

  const trimmed = token.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function GET(request: Request): Response {
  const token = resolveAssociation(requestedHost(request))

  // Unset, or a host this account never registered: behave exactly as the path
  // does today. A 404 is also the honest answer — serving an empty body would
  // read to Apple as a wrong token rather than an absent one.
  if (token === null) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(token, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Never cached. This is fetched a handful of times in the domain's life,
      // so there is nothing to gain — and a cached STALE token would fail
      // Apple's verification silently, after Tori had already fixed the value.
      'Cache-Control': 'no-store',
    },
  })
}
