// lib/proSession/elapsed.ts

/**
 * Formats the elapsed time since `startedAt` as `H:MM:SS`.
 *
 * Shared between the server-rendered session page and the client-side
 * <ElapsedTimer> so the displayed format stays identical. Pass `nowMs` to
 * keep the function pure/testable; it defaults to the current time.
 */
export function formatElapsed(
  startedAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!startedAt) return '0:00:00'

  const startMs =
    typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt.getTime()
  if (!Number.isFinite(startMs)) return '0:00:00'

  const elapsedMs = Math.max(0, nowMs - startMs)
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [
    String(hours),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':')
}
