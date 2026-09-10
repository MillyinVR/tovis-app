import { consultSuitabilityCopy } from './consultSuitabilityCopy'
import type { BrandClientConsultResultsCopy } from './types'

export const defaultClientConsultResultsCopy: BrandClientConsultResultsCopy = {
  suitability: consultSuitabilityCopy,
  // Names the DESTINATION only — ClientPage renders the ← glyph itself, and
  // lib/copy.ts's glossary says "booking", never "appointment".
  backToBooking: 'Booking',
  backToLook: 'Look',
  eyebrow: 'Your beauty consult',
  title: 'Directions to discuss with your professional',
  intro:
    'These photo-based directions can help start the conversation. Your professional will assess your hair in person and decide what is achievable.',
  clientWordsTitle: 'What you shared',
  aiObservationsTitle: 'What the photos suggest',
  aiObservationsBody:
    'These observations are a starting point for your professional to verify in person.',
  warmLightCaveat:
    '{warm} of your {total} photos were taken in warm indoor light, so the colour readings below are less certain than the rest. Your professional will check them in daylight.',
  baseLevelLabel: 'Color near your scalp',
  lightestLevelLabel: 'Lightest color in your hair',
  toneLabel: 'Color shade',
  conditionLabel: 'Visible condition',
  densityLabel: 'How full your hair looks',
  textureLabel: 'How straight or curly your hair looks',
  unknownLabel: 'Couldn’t tell from the photos',
  levelPrefix: 'Level',
  confidenceSuffix: 'confidence',
  safetyTitle: 'Safety and history to discuss',
  safetyEmpty:
    'The photo review did not find a specific concern. Your professional still needs to check your hair and treatment history before starting.',
  safetyItemSuffix: 'Discuss this with your professional before service.',
  achievabilityTitle: 'What may be achievable',
  achievabilityLabels: {
    LIKELY_SINGLE_APPOINTMENT: 'May be possible in one appointment',
    LIKELY_MULTI_APPOINTMENT: 'May take more than one appointment',
    REQUIRES_PRO_ASSESSMENT: 'Needs an in-person professional assessment',
    UNKNOWN: 'Needs an in-person professional assessment',
  },
  profileTitle: 'What your photos show',
  profileBody:
    'These details help explain the style ideas below. Photos can change how colors look. Your professional will check these details with you in person.',
  profileLabels: {
    skinUndertone: 'The shade beneath your skin’s surface',
    contrastLevel: 'Difference between your hair, skin, and eye colors',
    colorSeason: 'Suggested group of colors to try',
    faceProportion: 'Face length compared with width',
    jawline: 'Jawline',
    foreheadProportion: 'Forehead',
    featureBalance: 'How soft or defined your features look',
    eyeColor: 'Visible eye color',
    eyeShape: 'Eye shape',
    eyeSpacing: 'Eye spacing',
    browDensity: 'How full your eyebrows look',
    browShape: 'Brow shape',
  },
  styleDirectionsTitle: 'Style options to discuss',
  styleDirectionsBody:
    'Your preferences come first. These photo-based suggestions are optional starting points to discuss with your professional.',
  styleDomainLabels: {
    HAIR_COLOR_HARMONY: 'Hair color',
    CUT_AND_SHAPE: 'Cut & shape',
    BANGS: 'Bangs',
    BROWS: 'Brows',
    LASHES: 'Lashes',
    MAKEUP: 'Makeup',
    COLOR_PALETTE: 'Color palette',
  },
  whyItFlattersLabel: 'Why this could work for you',
  recommendationsTitle: 'Directions to discuss',
  singleRecommendationTitle: 'Your pro’s recommendation for this look',
  recommendationDiscussionPrefix: 'A direction to discuss with your professional:',
  bookLookTitle: 'Ready to book this look?',
  bookLookBody:
    'Your professional gets everything above with the booking, so you both start from the same place.',
  bookLookCta: 'Book this look',
  meCardEyebrow: 'Me card · locked',
  meCardTitle: 'Your fuller analysis can live here later',
  meCardBody:
    'The Me card is not available in this pilot. You can tell us this would interest you; this does not unlock anything or sign you up.',
  meCardTapLabel: 'I’m interested',
  meCardTappedLabel: 'Interest recorded · still locked',
  meCardSendingLabel: 'Recording…',
  meCardError:
    'We could not record that tap. Your Me card remains locked.',
}
