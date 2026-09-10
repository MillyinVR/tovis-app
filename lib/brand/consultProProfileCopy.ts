import type { ConsultProBriefDTO } from '@/lib/dto/consult'

export const consultProProfileLabels: Record<
  keyof ConsultProBriefDTO['profile'],
  string
> = {
  skinUndertone: 'Skin undertone',
  contrastLevel: 'Natural contrast',
  colorSeason: 'Color season',
  faceProportion: 'Face proportion',
  jawline: 'Jawline',
  foreheadProportion: 'Forehead',
  featureBalance: 'Feature balance',
  eyeColor: 'Visible eye color',
  eyeShape: 'Eye shape',
  eyeSpacing: 'Eye spacing',
  browDensity: 'Brow density',
  browShape: 'Brow shape',
  skinDepth: 'Skin depth',
  surfaceOvertone: 'Surface overtone',
  faceWidthBalance: 'Relative face widths',
  chinContour: 'Chin contour',
  eyeTilt: 'Eye tilt',
  lidVisibility: 'Lid visibility',
  browBoneRelationship: 'Brow-to-eye relationship',
  browArchPosition: 'Brow arch position',
  browTailDirection: 'Brow tail direction',
}

