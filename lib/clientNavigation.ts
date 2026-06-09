export function hardNavigate(url: string): void {
  if (typeof window === 'undefined') return
  window.location.assign(url)
}