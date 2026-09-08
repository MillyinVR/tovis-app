/** Profile settings never grant permission to retrieve or formulate from a line. */
export function parseConsultProductLines(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 12 || !value.every(line => typeof line === 'string' && line.trim().length > 0 && line.trim().length <= 80 && !/[\x00-\x1f]/.test(line))) return null
  return [...new Set(value.map(line => line.trim()))]
}
