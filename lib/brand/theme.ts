// lib/brand/theme.ts
//
// Color-scheme (light/dark) resolution. Industry-standard model:
//   preference = 'system' | 'light' | 'dark'  (default 'system')
//   - 'system' follows the device via prefers-color-scheme (live)
//   - 'light' / 'dark' are explicit user overrides, persisted
// The resolved value is a BrandMode ('light' | 'dark') used to pick brand
// tokens. A blocking inline script (see THEME_INIT_SCRIPT) applies the
// resolved mode to <html data-mode> before first paint to avoid a flash.
import type { BrandMode } from './types'

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'tovis-theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** Resolve a preference to a concrete mode using the device when 'system'. */
export function resolveMode(
  preference: ThemePreference,
  prefersDark: boolean,
): BrandMode {
  if (preference === 'dark') return 'dark'
  if (preference === 'light') return 'light'
  return prefersDark ? 'dark' : 'light'
}

/** Read the persisted preference (client only). */
export function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCE
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Apply the resolved mode to the document so CSS [data-mode] vars kick in. */
export function applyMode(mode: BrandMode): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.mode = mode
  el.style.colorScheme = mode
}

// ── External store (for useSyncExternalStore) ─────────────────────────────
// Subscribes React to two external sources: the persisted preference
// (localStorage, incl. cross-tab `storage` events) and the device's
// prefers-color-scheme. Snapshots are primitives so React's Object.is check
// keeps them stable across renders.

type Listener = () => void
const listeners = new Set<Listener>()
let cachedPreference: ThemePreference | null = null

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener)

  let cleanupMedia: (() => void) | undefined
  let cleanupStorage: (() => void) | undefined

  if (typeof window !== 'undefined') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMedia = () => emit()
    mq.addEventListener('change', onMedia)
    cleanupMedia = () => mq.removeEventListener('change', onMedia)

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        cachedPreference = null
        emit()
      }
    }
    window.addEventListener('storage', onStorage)
    cleanupStorage = () => window.removeEventListener('storage', onStorage)
  }

  return () => {
    listeners.delete(listener)
    cleanupMedia?.()
    cleanupStorage?.()
  }
}

export function getPreferenceSnapshot(): ThemePreference {
  if (cachedPreference === null) cachedPreference = readStoredPreference()
  return cachedPreference
}

export function getModeSnapshot(): BrandMode {
  return resolveMode(getPreferenceSnapshot(), prefersDark())
}

/** Server snapshots — no device/storage access; default to dark + system. */
export function getServerPreferenceSnapshot(): ThemePreference {
  return DEFAULT_THEME_PREFERENCE
}
export function getServerModeSnapshot(): BrandMode {
  return 'dark'
}

/** Persist a preference and notify subscribers. */
export function setStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // ignore (private mode, etc.)
  }
  cachedPreference = preference
  emit()
}

/**
 * Blocking script injected at the top of <body>. Runs before paint so the
 * correct theme is applied with no flash of the wrong colors. Kept tiny and
 * dependency-free; mirrors resolveMode/readStoredPreference above.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var p=localStorage.getItem(k);if(p!=='light'&&p!=='dark'&&p!=='system')p='system';var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var m=(p==='dark'||(p!=='light'&&d))?'dark':'light';var e=document.documentElement;e.dataset.mode=m;e.style.colorScheme=m;}catch(e){}})();`
