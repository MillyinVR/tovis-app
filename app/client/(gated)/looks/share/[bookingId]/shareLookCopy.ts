// app/client/(gated)/looks/share/[bookingId]/shareLookCopy.ts
//
// Product copy for the Share-your-look capture sheet. Kept out of the JSX so the
// strings live in one place (per the engagement-loop handoff §2). Generic UI
// text, not brand identity.

export const shareLookCopy = {
  title: 'Share your look',
  subtitlePrefix: 'From your visit',

  beforeLabel: 'Before',
  afterLabel: 'After',
  replacePhoto: 'Replace',
  addPhoto: 'Add photo',
  retakeAfter: 'Replace after photo',

  nameLabel: 'Name this look',
  namePlaceholder: 'e.g. Glazed donut blonde',

  captionLabel: 'Caption',
  captionPlaceholder: 'What made this look worth it?',

  taggedProLabel: 'Tagged pro',

  visibilityTitle: 'Public on your profile',
  visibilityHelp: 'Followers can save & recreate it',

  shareCta: 'Share look',
  privateCta: 'Save to my profile only',

  uploading: 'Uploading…',
  errorMissingAfter: 'Add an after photo to share your look.',
  errorMissingName: 'Give your look a name.',
  errorGeneric: 'Could not share your look. Please try again.',

  successPublic: 'Your look is live on your profile.',
  successPrivate: 'Saved to your profile.',
} as const
