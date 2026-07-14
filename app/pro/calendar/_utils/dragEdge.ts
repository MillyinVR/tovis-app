// app/pro/calendar/_utils/dragEdge.ts
//
// Pure geometry for cross-week drag auto-pagination: while a booking tile is
// being dragged in week view, dwelling the pointer in the left/right edge band
// of the timeline paginates to the previous/next week. This helper only decides
// which band the pointer sits in; the dwell timer + week flip live in
// `useDragEdgePagination`.

/** -1 = previous-week band (left edge), 1 = next-week band (right edge), 0 = neither. */
export type EdgePageDirection = -1 | 0 | 1

/**
 * Which horizontal edge band the pointer sits in, relative to the timeline's
 * left/right client bounds. The band is `threshold` px wide at each edge and is
 * inclusive of its inner boundary. A pointer dragged past an edge (off-screen)
 * still counts as that band. When the container is narrower than two thresholds
 * the left band wins (leading precedence), matching the iOS `edgePageDirection`.
 */
export function edgePageDirectionFromClientX(args: {
  clientX: number
  left: number
  right: number
  threshold: number
}): EdgePageDirection {
  const { clientX, left, right, threshold } = args

  if (clientX <= left + threshold) return -1
  if (clientX >= right - threshold) return 1
  return 0
}
