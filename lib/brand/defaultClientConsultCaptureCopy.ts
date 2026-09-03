import type { BrandClientConsultCaptureCopy } from './types'

// The capture step's framing. Counts are filled from the served shot pack by
// lib/consult/captureCopy.ts — never written here — so the hair pack reads
// "Seven daylight photos: four of your hair and three of your face" and the
// area pack "Three daylight photos: the area you'd like treated, and your face".
export const defaultClientConsultCaptureCopy: BrandClientConsultCaptureCopy = {
  eyebrow: 'Step 4 of 4',
  title: 'Your photos',
  introCountLine: '{count} daylight photos: {views}.',
  introHairAndFaceViews: '{hair} of your hair and {face} of your face',
  introFaceViews: '{face} of your face',
  introAreaViews: 'the area you’d like treated, and your face',
  introPartialAllowed:
    'Each one is checked right away, and if one can’t be used you’ll see why. You can run the analysis without all {count} — anything the missing photos would have shown just comes back as unknown.',
}
