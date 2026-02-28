// lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKETS } from '@/lib/storageBuckets'

function mustGetEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

/**
 * Server-only Supabase client (service role).
 * - Never import this into client components.
 * - Uses service role key, so treat it like a database password.
 */
let _admin: SupabaseClient | null = null

function getServiceRoleKey(): string {
  // Prefer a single canonical env var, but keep compatibility with your older names.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim()

  if (!key) {
    throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SECRET_KEY)')
  }

  return key
}

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin

  // URL is safe to read on server; NEXT_PUBLIC is fine here because we’re not leaking it.
  const url = mustGetEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = getServiceRoleKey()

  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return _admin
}

/**
 * Optional helper: centralize bucket names usage.
 * This doesn’t “do” anything by itself, but it keeps imports consistent.
 */
export const STORAGE_BUCKETS = BUCKETS

// Back-compat for: import { supabaseAdmin } from '@/lib/supabaseAdmin'
export const supabaseAdmin = getSupabaseAdmin()