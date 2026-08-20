// lib/blocks/types.ts
//
// Wire shapes for the person block (App Store guideline 1.2).
//
// 🔴 Deliberately NOT re-exported from lib/dto/index.ts. That barrel is the
// input to `gen:api-schema`, and `check:ios-fixture-contract` validates this
// branch's generated schema against tovis-ios `origin/main` — so exporting a
// new DTO here would redden this repo's CI until a matching iOS fixture PR
// merges. When the iOS block UI lands, add the exports in the same pair of PRs,
// tovis-ios first.

/** One blocked account in the viewer's own list. Carries no User id. */
export type BlockedAccountDto = {
  /** The UserBlock row's id — the key DELETE /api/v1/blocks/[blockId] takes. */
  blockId: string;
  /** The target's current public handle, or '' if they hold none. */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

export type BlocksListResponseDto = {
  blocks: BlockedAccountDto[];
};

/** POST /api/v1/blocks — idempotent, so this is also the already-blocked shape. */
export type BlockCreatedResponseDto = {
  blockId: string;
  handle: string;
  displayName: string;
  blocked: true;
};

/** DELETE /api/v1/blocks/[blockId] — idempotent; `blocked` is always false. */
export type BlockRemovedResponseDto = {
  blockId: string;
  blocked: false;
};
