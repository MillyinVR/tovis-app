# Self-hosted brand fonts

These three families are the brand sheet, loaded by `app/layout.tsx` through
`next/font/local`.

## Why they are committed rather than fetched

`next/font/google` downloads font binaries from `fonts.gstatic.com` **at build
time**. That makes every build — CI, preview and production — depend on Google's
CDN serving one exact hashed URL, and on 2026-08-13 it stopped:

```
Received response with status 404 when requesting
https://fonts.gstatic.com/s/hankengrotesk/v12/ieVd2YZ…8Joxh47n9VM.woff2
Error: Turbopack build failed with 20 errors:
  Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
  Import trace: ./app/layout.tsx
```

Google had rotated Hanken Grotesk's file hashes. The URL the build resolved was
retired, while `fonts.googleapis.com/css2` kept answering 200 with *new* URLs —
so the failure looked intermittent (it depended on which URL a given build had
cached) and would have gone on breaking builds at random, including a production
deploy.

Serving the bytes from the repo removes the network from the build entirely.
Runtime behaviour is unchanged: `next/font/google` already self-hosted these at
runtime, so no request ever went to Google from a user's browser either way.

## What is here

| File | Family | Notes |
| --- | --- | --- |
| `hanken-grotesk-variable.woff2` | Hanken Grotesk | Variable, `400–800` |
| `space-grotesk-variable.woff2` | Space Grotesk | Variable, `400–700` |
| `space-mono-400.woff2` | Space Mono | Static |
| `space-mono-700.woff2` | Space Mono | Static |

Google was already serving **one variable file per family** — it returned the
byte-identical file for every weight in `wght@400;500;600;700;800`, with the CSS
declaring a different `font-weight` against each copy. So a single file per
variable family is what was always being downloaded, not a reduction in
fidelity. Space Mono has no variable version; its two weights are genuinely
different files.

Latin subset only, matching the previous `subsets: ['latin']`.

## Licensing

All three are SIL Open Font License 1.1 — see `OFL-hankengrotesk.txt`,
`OFL-spacegrotesk.txt`, `OFL-spacemono.txt`, copied verbatim from
`github.com/google/fonts`. The OFL permits redistribution provided the license
travels with the files, which is why they are committed beside them. **This repo
is public — keep the license files next to the fonts.**

## Refreshing them

Only needed to pick up an upstream font update; there is no expiry and nothing
breaks if they are never touched.

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# 1. Read the CSS and copy the URL from the `/* latin */` block.
curl -s -A "$UA" 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap'

# 2. Download that URL over the existing file.
curl -s -A "$UA" '<latin url>' -o app/fonts/hanken-grotesk-variable.woff2
```

The Chrome UA matters: Google serves `ttf` to unrecognised clients and `woff2`
only to modern browsers. Verify the result starts with the magic bytes `wOF2`,
then run `pnpm build` before committing — that is the only check that proves the
font still resolves.
