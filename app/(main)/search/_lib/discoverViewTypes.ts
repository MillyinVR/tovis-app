// app/(main)/search/_lib/discoverViewTypes.ts

export type DiscoverViewMode = 'MAP' | 'GRID'

// Top-level Discover surface: a looks-first inspiration grid (default) vs the
// pro-finder (list + map). Replaces MAP/GRID as the primary axis; MAP/GRID now
// only toggles the mobile presentation *within* the pro-finder.
export type DiscoverMode = 'LOOKS' | 'PROS'