// lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

function mustGetEnv(name: string) {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

/**
 * Server-only Supabase client (service role).
 * Do NOT import this into client components.
 */

let _admin: SupabaseClient | null = null

export function getSupabaseAdmin() {
  if (_admin) return _admin

  const url = mustGetEnv('NEXT_PUBLIC_SUPABASE_URL') // ok to read on server too
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!key) throw new Error('Missing env var: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')

  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return _admin
}

// Back-compat for imports like: import { supabaseAdmin } from '@/lib/supabaseAdmin'
export const supabaseAdmin = getSupabaseAdmin()