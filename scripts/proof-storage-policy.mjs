// scripts/proof-storage-policy.mjs
//
// Real production proof for TOVIS media storage RLS posture + the signed-upload
// PUT-vs-POST fix. READ-ONLY against existing data; the only writes are throwaway
// objects under `media-private/proof/...` and `media-public/proof/...`, all
// deleted at the end.
//
// Run:
//   node --env-file=.env.production.local scripts/proof-storage-policy.mjs
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//           NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

import { createClient } from '@supabase/supabase-js'

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '')
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim()

if (!URL_BASE || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
  process.exit(2)
}

const ref = URL_BASE.replace(/^https?:\/\//, '').split('.')[0]
console.log(`\nTOVIS storage policy proof — project ${ref}\n${'='.repeat(48)}`)

const admin = createClient(URL_BASE, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const results = []
const record = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
}

// Find a real *file* (folders have null id) by BFS under the given roots.
async function findFile(bucket, roots) {
  const queue = [...roots]
  for (let i = 0; i < 5000 && queue.length; i++) {
    const prefix = queue.shift()
    const { data } = await admin.storage.from(bucket).list(prefix, { limit: 100 })
    if (!data) continue
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id) return full
      queue.push(full)
    }
  }
  return null
}

const send = (method, url, headers, body) =>
  fetch(url, { method, headers, body }).then(async (r) => ({ status: r.status, text: await r.text() }))
const get = (url, headers) =>
  fetch(url, { method: 'GET', headers }).then(async (r) => ({ status: r.status, len: (await r.arrayBuffer()).byteLength }))

async function uploadToken(path) {
  const { data, error } = await admin.storage.from('media-private').createSignedUploadUrl(path)
  if (error || !data?.token) throw new Error(`createSignedUploadUrl failed: ${error?.message}`)
  return data.token
}

async function main() {
  const privatePath = process.argv[2] || (await findFile('media-private', ['bookings']))

  if (!privatePath) {
    record('discover private object', false, 'no media-private object found to test reads')
  } else {
    console.log(`\nUsing real private object: media-private/${privatePath}\n`)

    // PROOF A: anonymous direct read of a real private object is DENIED.
    const anonRead = await get(`${URL_BASE}/storage/v1/object/media-private/${privatePath}`, { apikey: ANON_KEY })
    record('A. anon direct read of media-private object', anonRead.status !== 200, `expected non-200, got HTTP ${anonRead.status} (denied)`)
    const anonPublic = await get(`${URL_BASE}/storage/v1/object/public/media-private/${privatePath}`, {})
    record('A. anon /public/ read of media-private object', anonPublic.status !== 200, `expected non-200 (bucket not public), got HTTP ${anonPublic.status}`)

    // PROOF B: authorized service-role signed read is ALLOWED.
    const { data: signed, error: signErr } = await admin.storage.from('media-private').createSignedUrl(privatePath, 60)
    if (signErr || !signed?.signedUrl) {
      record('B. service-role signed read of media-private', false, `createSignedUrl failed: ${signErr?.message}`)
    } else {
      const signedRead = await get(signed.signedUrl, {})
      record('B. service-role signed read of media-private', signedRead.status === 200 && signedRead.len > 0, `signed URL -> HTTP ${signedRead.status}, ${signedRead.len} bytes`)
    }
  }

  // PROOF C: the signed-upload PUT-vs-POST behavior on media-private.
  const stamp = Date.now()
  const cleanup = []
  const headers = { apikey: ANON_KEY, 'Content-Type': 'text/plain', 'x-upsert': 'false' }

  // C1: PUT (the SHIPPED behavior) must succeed — token authorizes, RLS bypassed.
  {
    const path = `proof/${stamp}_put.txt`
    const res = await send('PUT', `${URL_BASE}/storage/v1/object/upload/sign/media-private/${path}?token=${await uploadToken(path)}`, headers, 'proof-put')
    const ok = res.status >= 200 && res.status < 300
    if (ok) cleanup.push(path)
    record('C1. signed upload via PUT (shipped fix)', ok, `apikey only, token in URL -> HTTP ${res.status} ${ok ? '(upload accepted)' : '— ' + res.text.slice(0, 160)}`)
  }

  // C2: POST (the OLD behavior) must fail — reproduces the bug.
  {
    const path = `proof/${stamp}_post.txt`
    const res = await send('POST', `${URL_BASE}/storage/v1/object/upload/sign/media-private/${path}?token=${await uploadToken(path)}`, headers, 'proof-post')
    if (res.status >= 200 && res.status < 300) cleanup.push(path)
    const reproduced = res.status === 400 || res.status === 403
    record('C2. signed upload via POST reproduces the bug', reproduced, `expected 400/403 RLS, got HTTP ${res.status} — ${res.text.slice(0, 120)}`)
  }

  // PROOF D: anon public read of a real media-public file works.
  {
    const pubPath = await findFile('media-public', ['', 'pro', 'reviews', 'looks'])
    if (!pubPath) {
      record('D. anon public read of media-public', false, 'no media-public file found')
    } else {
      const pub = await get(`${URL_BASE}/storage/v1/object/public/media-public/${pubPath}`, {})
      record('D. anon public read of media-public', pub.status === 200, `media-public/${pubPath} -> HTTP ${pub.status}, ${pub.len} bytes`)
    }
  }

  if (cleanup.length) {
    const { error } = await admin.storage.from('media-private').remove(cleanup)
    console.log(`\nCleanup: removed ${cleanup.length} proof object(s)${error ? ' — ERROR: ' + error.message : ' OK'}`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${'='.repeat(48)}\n${results.length - failed.length}/${results.length} checks passed.`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('proof script crashed:', e)
  process.exit(3)
})
