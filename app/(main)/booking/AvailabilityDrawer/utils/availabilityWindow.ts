// app/(main)/booking/AvailabilityDrawer/utils/availabilityWindow.ts
export const INITIAL_WINDOW_DAYS = 7
export const NEXT_WINDOW_DAYS = 14
export const SELECTED_DAY_PREFETCH_THRESHOLD = 2
export const SCROLL_PREFETCH_THRESHOLD_PX = 120

export function shouldPrefetchForSelectedIndex(args: {
  selectedIndex: number
  loadedCount: number
  threshold?: number
}): boolean {
  const threshold = args.threshold ?? SELECTED_DAY_PREFETCH_THRESHOLD

  if (args.selectedIndex < 0) return false
  return args.loadedCount - args.selectedIndex - 1 <= threshold
}

export function shouldPrefetchForScrollPosition(args: {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  thresholdPx?: number
}): boolean {
  const thresholdPx = args.thresholdPx ?? SCROLL_PREFETCH_THRESHOLD_PX

  return args.scrollLeft + args.clientWidth >= args.scrollWidth - thresholdPx
}