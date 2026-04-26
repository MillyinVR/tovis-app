// app/pro/calendar/_viewModel/proCalendarResponsive.ts

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProCalendarDeviceShell = 'mobile' | 'tablet' | 'desktop'

export type ProCalendarBreakpointKey =
  | 'mobileMax'
  | 'tabletMin'
  | 'desktopMin'

export type ProCalendarBreakpoint = {
  key: ProCalendarBreakpointKey
  valuePx: number
  mediaQuery: string
  description: string
}

export type ProCalendarShellConfig = {
  device: ProCalendarDeviceShell
  label: string
  description: string
  shouldShowMobileFloatingActions: boolean
  shouldShowDesktopSidebar: boolean
  shouldUseCompactStats: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRO_CALENDAR_TABLET_MIN_WIDTH_PX = 768
export const PRO_CALENDAR_DESKTOP_MIN_WIDTH_PX = 1024

export const PRO_CALENDAR_BREAKPOINTS: Record<
  ProCalendarBreakpointKey,
  ProCalendarBreakpoint
> = {
  mobileMax: {
    key: 'mobileMax',
    valuePx: PRO_CALENDAR_TABLET_MIN_WIDTH_PX - 1,
    mediaQuery: `(max-width: ${PRO_CALENDAR_TABLET_MIN_WIDTH_PX - 1}px)`,
    description: 'Mobile calendar shell: compact prototype-style layout.',
  },

  tabletMin: {
    key: 'tabletMin',
    valuePx: PRO_CALENDAR_TABLET_MIN_WIDTH_PX,
    mediaQuery: `(min-width: ${PRO_CALENDAR_TABLET_MIN_WIDTH_PX}px)`,
    description:
      'Tablet calendar shell: wide header, no mobile floating bars, no desktop sidebar.',
  },

  desktopMin: {
    key: 'desktopMin',
    valuePx: PRO_CALENDAR_DESKTOP_MIN_WIDTH_PX,
    mediaQuery: `(min-width: ${PRO_CALENDAR_DESKTOP_MIN_WIDTH_PX}px)`,
    description:
      'Desktop calendar shell: wide header, left management rail, full calendar grid.',
  },
}

export const PRO_CALENDAR_SHELL_CONFIG: Record<
  ProCalendarDeviceShell,
  ProCalendarShellConfig
> = {
  mobile: {
    device: 'mobile',
    label: 'Mobile',
    description:
      'Prototype-style stacked layout with compact stats, mobile controls, floating pending tray, auto-accept bar, and FAB.',
    shouldShowMobileFloatingActions: true,
    shouldShowDesktopSidebar: false,
    shouldUseCompactStats: true,
  },

  tablet: {
    device: 'tablet',
    label: 'Tablet',
    description:
      'Intermediate layout with wide header, compact stats, full-width calendar, and no mobile floating controls.',
    shouldShowMobileFloatingActions: false,
    shouldShowDesktopSidebar: false,
    shouldUseCompactStats: true,
  },

  desktop: {
    device: 'desktop',
    label: 'Desktop',
    description:
      'Command-center layout with wide header, left sidebar, full stats rail, location panel, legend, auto-accept card, and full calendar grid.',
    shouldShowMobileFloatingActions: false,
    shouldShowDesktopSidebar: true,
    shouldUseCompactStats: false,
  },
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function proCalendarShellForWidth(
  widthPx: number,
): ProCalendarDeviceShell {
  if (!Number.isFinite(widthPx) || widthPx < 0) return 'mobile'

  if (widthPx >= PRO_CALENDAR_DESKTOP_MIN_WIDTH_PX) {
    return 'desktop'
  }

  if (widthPx >= PRO_CALENDAR_TABLET_MIN_WIDTH_PX) {
    return 'tablet'
  }

  return 'mobile'
}

export function proCalendarShellConfig(
  shell: ProCalendarDeviceShell,
): ProCalendarShellConfig {
  return PRO_CALENDAR_SHELL_CONFIG[shell]
}

export function isMobileCalendarShell(
  shell: ProCalendarDeviceShell,
): shell is 'mobile' {
  return shell === 'mobile'
}

export function isTabletCalendarShell(
  shell: ProCalendarDeviceShell,
): shell is 'tablet' {
  return shell === 'tablet'
}

export function isDesktopCalendarShell(
  shell: ProCalendarDeviceShell,
): shell is 'desktop' {
  return shell === 'desktop'
}

export function shouldShowMobileFloatingCalendarActions(
  shell: ProCalendarDeviceShell,
): boolean {
  return proCalendarShellConfig(shell).shouldShowMobileFloatingActions
}

export function shouldShowDesktopCalendarSidebar(
  shell: ProCalendarDeviceShell,
): boolean {
  return proCalendarShellConfig(shell).shouldShowDesktopSidebar
}

export function shouldUseCompactCalendarStats(
  shell: ProCalendarDeviceShell,
): boolean {
  return proCalendarShellConfig(shell).shouldUseCompactStats
}

export function calendarShellDataAttribute(
  shell: ProCalendarDeviceShell,
): ProCalendarDeviceShell {
  return shell
}