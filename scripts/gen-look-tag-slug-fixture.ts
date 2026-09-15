// scripts/gen-look-tag-slug-fixture.ts
//
// Writes schema/parity/lookTagSlugs.json from the REAL slug functions. Run via
// `pnpm gen:look-tag-slug-fixture`. The committed result is what tovis-ios's
// Swift twin (`LooksPath.slugifyTag` / `LooksPath.tagSlug`) is tested against,
// so regenerating it is how a change to web's slug rule reaches the phone.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  LOOK_TAG_SLUG_FIXTURE_PATH,
  renderLookTagSlugFixture,
} from '../lib/looks/tagSlugParityFixture'

const target = resolve(process.cwd(), LOOK_TAG_SLUG_FIXTURE_PATH)
writeFileSync(target, renderLookTagSlugFixture(), 'utf8')
console.log('wrote ' + LOOK_TAG_SLUG_FIXTURE_PATH)
