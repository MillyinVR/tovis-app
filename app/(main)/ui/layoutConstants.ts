// app/(main)/ui/layoutConstants.ts

export const UI_SIZES = {
  footerHeight: 65, // ✅ matches ProSessionFooter
  headerSafeTop: 74, // overlay header space (tabs + search)
  rightRailBottomOffset: 14, // extra breathing room above footer (used for overlay text)
  rightRailBottom: 20, // px from feed viewport bottom for the action rail itself
} as const
