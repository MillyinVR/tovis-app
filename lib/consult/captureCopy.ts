// lib/consult/captureCopy.ts
//
// The capture step's intro, derived from the SERVED shot pack rather than
// written for the hair pack. "Seven daylight photos: four of your hair and
// three of your face … without all seven" was true for one of the three packs
// the server can serve; a nails consult (area pack, three shots) read it and
// waited for four more slots that would never appear. The copy template is
// brand copy (lib/brand); the counts and the view wording come from the pack.
//
// Client-safe on purpose: imported by the flow (a client component), so it
// reads the wire DTO and nothing server-side.

import type { BrandClientConsultCaptureCopy } from '@/lib/brand/types'
import type { ConsultCaptureShotPackDTO } from '@/lib/dto/consult'

const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const

function countInWords(count: number): string {
  return COUNT_WORDS[count] ?? String(count)
}

function fill(template: string, slots: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => slots[key] ?? match)
}

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** What the pack photographs, read off its shot keys — never off its id. */
export function describeConsultCapturePack(
  pack: Pick<ConsultCaptureShotPackDTO, 'shots'>,
): { total: number; hair: number; face: number; area: number } {
  let hair = 0
  let face = 0
  let area = 0
  for (const shot of pack.shots) {
    if (shot.key.startsWith('hair_')) hair += 1
    else if (shot.key.startsWith('area_')) area += 1
    else face += 1
  }
  return { total: pack.shots.length, hair, face, area }
}

/**
 * The two-sentence intro over the capture slots: the count line, then the
 * partial-submission reassurance. Both name the pack's OWN count.
 */
export function formatConsultCaptureIntro(
  copy: BrandClientConsultCaptureCopy,
  pack: Pick<ConsultCaptureShotPackDTO, 'shots'>,
): string {
  const counts = describeConsultCapturePack(pack)
  const count = countInWords(counts.total)
  const views =
    counts.area > 0
      ? copy.introAreaViews
      : counts.hair > 0
        ? fill(copy.introHairAndFaceViews, {
            hair: countInWords(counts.hair),
            face: countInWords(counts.face),
          })
        : fill(copy.introFaceViews, { face: countInWords(counts.face) })
  const countLine = capitalize(fill(copy.introCountLine, { count, views }))
  return `${countLine} ${fill(copy.introPartialAllowed, { count })}`
}
