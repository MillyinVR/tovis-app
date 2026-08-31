import type { BrandClientConsultResultsCopy } from './types'

export const defaultClientConsultResultsCopy: BrandClientConsultResultsCopy = {
  // Names the DESTINATION only — ClientPage renders the ← glyph itself, and
  // lib/copy.ts's glossary says "booking", never "appointment".
  backToBooking: 'Booking',
  backToLook: 'Look',
  eyebrow: 'Your beauty consult',
  title: 'Directions to discuss with your professional',
  intro:
    'These photo-based directions can help start the conversation. Your professional will assess your hair in person and decide what is achievable.',
  clientWordsTitle: 'What you shared',
  aiObservationsTitle: 'Photo-based observations',
  aiObservationsBody:
    'These observations are a starting point for your professional to verify in person.',
  currentLevelLabel: 'Current level range',
  toneLabel: 'Visible tone',
  conditionLabel: 'Visible condition',
  densityLabel: 'Density',
  textureLabel: 'Texture',
  unknownLabel: 'Unknown',
  levelPrefix: 'Levels',
  confidenceSuffix: 'confidence',
  safetyTitle: 'Safety and history to discuss',
  safetyEmpty:
    'No safety flags were identified by this analysis. Confirm your history and service suitability with your professional in person.',
  safetyItemSuffix: 'Discuss this with your professional before service.',
  achievabilityTitle: 'What may be achievable',
  achievabilityLabels: {
    LIKELY_SINGLE_APPOINTMENT: 'May be possible in one appointment',
    LIKELY_MULTI_APPOINTMENT: 'May take more than one appointment',
    REQUIRES_PRO_ASSESSMENT: 'Needs an in-person professional assessment',
    UNKNOWN: 'Needs an in-person professional assessment',
  },
  profileTitle: 'Your feature profile',
  profileBody:
    'What the photos suggest about your features, so recommendations enhance what is already yours. Your professional confirms these in person — color readings from photos are approximate.',
  profileLabels: {
    skinUndertone: 'Skin undertone',
    contrastLevel: 'Natural contrast',
    colorSeason: 'Color season',
    faceProportion: 'Face proportion',
    jawline: 'Jawline',
    foreheadProportion: 'Forehead',
    featureBalance: 'Feature balance',
    eyeShape: 'Eye shape',
    eyeSpacing: 'Eye spacing',
    browDensity: 'Brow density',
    browShape: 'Brow shape',
  },
  styleDirectionsTitle: 'What will flatter you most',
  styleDirectionsBody:
    'One direction per area, chosen to enhance your actual features rather than follow a trend. Each one is a starting point to discuss with your professional.',
  styleDomainLabels: {
    HAIR_COLOR_HARMONY: 'Hair color',
    CUT_AND_SHAPE: 'Cut & shape',
    BANGS: 'Bangs',
    BROWS: 'Brows',
    LASHES: 'Lashes',
    MAKEUP: 'Makeup',
    COLOR_PALETTE: 'Color palette',
  },
  whyItFlattersLabel: 'Why this flatters you',
  recommendationsTitle: 'Hair-color directions',
  recommendationDiscussionPrefix: 'A direction to discuss with your professional:',
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
