import type { ConsultIntakeQuestionDTO, ConsultCaptureShotKeyDTO } from '@/lib/dto/consult'

// Presentation only: archived question packs, answer values, requirements and
// safety rules remain unchanged. Both clients receive these same descriptions.
const questions: Readonly<Record<string, { label: string; helpText?: string }>> = {
  box_dye_history: { label: 'When did you last use store-bought hair dye at home?', helpText: 'This includes dye sold in a box or kit. If you don’t know what was used, choose “Not sure”.' },
  prior_lightening: { label: 'When was your hair last made lighter with hair color or bleach?', helpText: 'Include all-over color and lighter pieces, often called highlights. Choose “Not sure” if you don’t know.' },
  henna_plant_dye_history: { label: 'When did you last use henna or another hair dye made from plants?', helpText: 'Henna is a plant-based dye. If you don’t know what was used, choose “Not sure”.' },
  chemical_history: { label: 'When did you last have a treatment that changes your hair’s color, curl, or straightness?', helpText: 'Include hair dye, bleach, treatments that add curls (perms), and treatments that straighten or smooth hair. Don’t count everyday shampoo or styling with heat.' },
  other_chemical_history: { label: 'When did you last have another hair treatment besides hair color?', helpText: 'Include treatments that add lasting curls, straighten or loosen curls, or smooth hair. These may be called perms, relaxers, or keratin treatments. Include other chemical treatments too, but not everyday washing, conditioning, or heat styling. Choose “Not sure” if you don’t know.' },
  perm_history: { label: 'When did you last have a treatment that adds lasting curls or waves (a perm)?' },
  relaxer_texturizer_history: { label: 'When did you last have a treatment that straightens or loosens curls (a relaxer or texturizer)?' },
  keratin_smoothing_history: { label: 'When did you last have a salon treatment to make your hair smoother, such as keratin?' },
  maintenance_tolerance: { label: 'How much time and effort do you want to spend keeping this look?', helpText: 'Think about styling at home and coming back for salon visits.' },
  hair_texture: { label: 'How does your hair dry naturally, without styling tools or treatments?' },
  event_timing: { label: 'Do you need this look ready for a particular date?' },
  last_color_service_timing: { label: 'When did you last have your hair colored?' },
}
const options: Readonly<Record<string, string>> = {
  'goal_direction:warmer': 'Add more golden or reddish shades',
  'goal_direction:less-warm': 'Reduce golden, orange, or reddish shades',
  'goal_direction:brighter-pieces': 'Add some lighter pieces',
  'goal_direction:softer-root-contrast': 'Make the color near my scalp blend in more gradually',
  'goal_direction:gray-blending': 'Help gray or silver hairs blend with the rest',
  'goal_direction:more-shine': 'Add shine or freshen the shade',
  'goal_direction:volume-fullness': 'How thick and full it looks',
  'goal_direction:texture-movement': 'How straight or curly it looks, or how it moves',
  'maintenance_tolerance:low': 'As little as possible',
  'maintenance_tolerance:medium': 'Some styling and return visits are fine',
  'maintenance_tolerance:high': 'I’m happy to style it often and return regularly',
  'change_scale:subtle': 'A small change',
  'change_scale:noticeable': 'A change people will notice',
  'change_scale:total': 'A completely different look',
  'hair_texture:coily': 'Very tight curls',
}
export function clientConsultQuestion(packId: string, question: ConsultIntakeQuestionDTO): ConsultIntakeQuestionDTO {
  // Shared keys can mean something different for nails, skin, or makeup.
  if (packId !== 'hair-color' && packId !== 'hair-general') return question
  return {
    ...question,
    ...questions[question.key],
    ...(question.key === 'goal_direction' ? { helpText: 'Choose the part you most want to change. You can change your answer later.' } : {}),
    options: question.options.map(option => ({ ...option, label: options[`${question.key}:${option.value}`] ?? option.label })),
  }
}

export const consultClientShotCopy: Partial<Record<ConsultCaptureShotKeyDTO, { title: string; instruction: string }>> = {
  hair_back: { title: 'Back of your hair', instruction: 'Stand near a window, out of direct sun, with indoor lights off. Face away from the camera. Show all your hair, from next to your scalp to the ends. Keep the photo clear and use no filters.' },
  hair_left: { title: 'Left side of your hair', instruction: 'Stand near a window, out of direct sun, with indoor lights off. Turn your left side toward the camera. Show your hair from next to your scalp to the ends. Use no filters.' },
  hair_right: { title: 'Right side of your hair', instruction: 'Stand near a window, out of direct sun, with indoor lights off. Turn your right side toward the camera. Show your hair from next to your scalp to the ends. Use no filters.' },
  hair_crown: { title: 'Top of your head', instruction: 'Stand near a window, out of direct sun, with indoor lights off. Tilt your head so the camera can see the top. Show where your hair parts and the hair around it clearly. Use no filters.' },
  face_front: { title: 'Front of your face', instruction: 'Face the camera near a window, out of direct sun, with indoor lights off. Relax your face and move your hair back so your whole face, hairline, eyes, eyebrows, and jaw are clear. Use no filters.' },
  face_side: { title: 'Side of your face', instruction: 'Turn fully to one side near a window, out of direct sun, with indoor lights off. Tuck your hair behind your ear. Show your whole forehead, nose, lips, chin, and jaw clearly. Use no filters.' },
  eyes_closeup: { title: 'Eyes and eyebrows', instruction: 'Look straight at the camera with your eyes open. Get close enough to show both eyes and both whole eyebrows clearly. Use window light, out of direct sun, with indoor lights off. Use no filters.' },
}
