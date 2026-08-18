// app/(main)/booking/AvailabilityDrawer/constants.ts

import { UI_SIZES } from '../../ui/layoutConstants'

export const SHEET_MAX_W = 520
export const SHEET_SIDE_PAD = 14
export const STICKY_CTA_H = 86

// Desktop-only (see MEDIA.desktop in DrawerShell): below this width the sheet
// is a bottom sheet that fills nearly the full viewport height, matching a
// native mobile sheet. At desktop width that same full-height composition
// floats a phone-sized card in a sea of dead scrim — the drawer needs a real
// desktop shape instead, a centered dialog capped in both dimensions, the
// same "floating card with margin on every side" iOS already gets for free
// from its own sheet presentation (client-parity-brief.md finding #2).
export const SHEET_MAX_H_DESKTOP = 760
export const SHEET_DESKTOP_MARGIN = 48
