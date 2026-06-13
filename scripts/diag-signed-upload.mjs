// scripts/diag-signed-upload.mjs — diagnostic only. Finds which signed-upload
// variant actually succeeds against media-private. Cleans up after itself.
//   node --env-file=.env.production.local scripts/diag-signed-upload.mjs
import { createClient } from '@supabase/supabase-js'

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '')
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()

const admin = createClient(URL_BASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(URL_BASE, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// Key format hints (no secret values printed).
const fmt = (k) => (k.startsWith('sb_secret_') ? 'sb_secret_*' : k.startsWith('sb_publishable_') ? 'sb_publishable_*' : k.startsWith('eyJ') ? 'legacy-JWT' : 'unknown')
console.log(`service key format: ${fmt(SERVICE_KEY)}`)
console.log(`anon/publishable key format: ${fmt(ANON_KEY)}\n`)

const cleanup = []
async function freshToken(tag) {
  const path = `proof/diag_${Date.now()}_${tag}.txt`
  const { data, error } = await admin.storage.from('media-private').createSignedUploadUrl(path)
  if (error) { console.log(`  createSignedUploadUrl(${tag}) ERROR: ${error.message}`); return null }
  // Inspect token shape (length only).
  return { path, token: data.token, signedUrl: data.signedUrl }
}

async function manual(method, tag, extraHeaders) {
  const t = await freshToken(tag)
  if (!t) return
  const headers = { apikey: ANON_KEY, 'Content-Type': 'text/plain', 'x-upsert': 'false', ...extraHeaders }
  const r = await fetch(`${URL_BASE}/storage/v1/object/upload/sign/media-private/${t.path}?token=${t.token}`, { method, headers, body: 'x' })
  const body = await r.text()
  const ok = r.status >= 200 && r.status < 300
  if (ok) cleanup.push(t.path)
  console.log(`${ok ? 'OK ' : 'XX '} ${tag}: HTTP ${r.status} ${ok ? '' : '— ' + body.slice(0, 120)}`)
}

async function sdk(client, tag) {
  const t = await freshToken(tag)
  if (!t) return
  const { error } = await client.storage.from('media-private').uploadToSignedUrl(t.path, t.token, new Blob(['x'], { type: 'text/plain' }))
  if (!error) cleanup.push(t.path)
  console.log(`${error ? 'XX ' : 'OK '} ${tag}: ${error ? error.message : 'uploaded'}`)
}

async function main() {
  await manual('POST', 'manual-POST-apikey-only')
  await manual('PUT', 'manual-PUT-apikey-only')
  await manual('POST', 'manual-POST-apikey+anonBearer', { Authorization: `Bearer ${ANON_KEY}` })
  await manual('PUT', 'manual-PUT-apikey+serviceBearer', { Authorization: `Bearer ${SERVICE_KEY}` })
  await manual('POST', 'manual-POST-serviceApikey+serviceBearer', { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
  await sdk(anon, 'sdk-uploadToSignedUrl-anonClient')
  await sdk(admin, 'sdk-uploadToSignedUrl-adminClient')

  if (cleanup.length) {
    const { error } = await admin.storage.from('media-private').remove(cleanup)
    console.log(`\ncleanup removed ${cleanup.length}${error ? ' ERROR ' + error.message : ''}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
