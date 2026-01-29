// lib/cache/ttlCache.ts
type Entry<T> = { value: T; expiresAt: number }

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>()

  constructor(private maxEntries = 500) {}

  get(key: string): T | null {
    const hit = this.store.get(key)
    if (!hit) return null
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key)
      return null
    }
    return hit.value
  }

  set(key: string, value: T, ttlMs: number) {
    // basic eviction to avoid unbounded growth
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value
      if (firstKey) this.store.delete(firstKey)
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  delete(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

export function stableKey(parts: Array<string | number | null | undefined>) {
  return parts.map((p) => String(p ?? '')).join('|')
}
