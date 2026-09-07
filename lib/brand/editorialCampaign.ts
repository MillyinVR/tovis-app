import { editorialRetention } from './editorialRetention'
import { editorialSeo } from './editorialSeo'
/** Brand-owned campaign content. Native screenshots are opt-in per brand. */
export type EditorialCampaign = ReturnType<typeof editorialCampaign>
export function editorialCampaign() {
  const asset = (file: string) => `/editorial/campaign/${file}.webp`
  return {
    seo: editorialSeo(),
    retention: editorialRetention(),
    palette: {
      deep: '11 52 48',
      cream: '243 240 231',
      ink: '10 20 19',
      gold: '242 180 62',
      teal: '21 201 168',
      violet: '107 75 230',
    },
    announcement: 'San Diego, you’re up first.',
    strap: 'Beauty. Barbering. Whatever’s next.',
    eyebrow: 'Good looks. Your way.',
    intro: 'Discover beauty looks. Book hairstylists, barbers, nail techs, and beauty professionals. Starting in San Diego.',
    sticker: 'Your next look lives here.',
    nav: [
      { href: '#discovery', label: 'Explore looks' },
      { href: '#pros', label: 'For professionals' },
      { href: '#loop', label: 'Inside the app' },
    ],
    photos: [
      {
        src: asset('extensions-mirror-approved'),
        alt: 'Generated editorial mirror selfie of a client and professional during an extension appointment',
        title: 'Length, with intention.',
        category: 'Hair',
        label: 'Extensions',
        caption: 'Your next chapter.',
      },
      {
        src: asset('nails'),
        alt: 'Generated cobalt and silver nail art',
        title: 'Details worth saving.',
        category: 'Nails',
        label: 'Nails',
        caption: 'Small details.',
      },
      {
        src: asset('blonde'),
        alt: 'Generated editorial portrait of a laughing adult with a copper bob',
        title: 'A little more dimension.',
        category: 'Hair',
        label: 'Color',
        caption: 'A whole new mood.',
      },
      {
        src: asset('brows'),
        alt: 'Generated editorial portrait of an adult man with sculpted brows and subtle eye makeup',
        title: 'The finishing touch.',
        category: 'Brows & lashes',
        label: 'Brows & lashes',
        caption: 'Make it personal.',
      },
      {
        src: asset('clipper-cut-approved'),
        alt: 'Generated editorial barber using a guarded clipper on a textured cut',
        title: 'A fresh perspective.',
        category: 'Barbering',
        label: 'Barbering',
        caption: 'A fresh perspective.',
      },
      {
        src: asset('curls'),
        alt: 'Generated editorial portrait featuring natural curls',
        title: 'Let the curls do their thing.',
        category: 'Hair',
        label: 'Curls',
        caption: 'Your texture.',
      },
    ],
    categories: ['All looks', 'Barbering', 'Hair', 'Nails', 'Brows & lashes'],
    discoveryEyebrow: 'The inspiration edit',
    discoveryTitle: 'What’s your next look?',
    conceptLabel: 'Editorial concept',
    saveLabel: 'Save',
    savedLabel: 'Saved',
    savedSuffix: 'saved in this preview',
    saveIntro: 'Save a little inspiration',
    disclosure:
      'Generated editorial placeholders. These examples are not bookable. Preview saves stay on this page.',
    appEyebrow: 'Inside the app',
    appTitle: 'See something you love. Start there.',
    screens: [
      {
        title: 'The Looks feed.',
        body: 'Explore the work, save inspiration, and open the professional’s booking journey.',
        src: asset('ios-looks'),
        alt: 'Tovis iOS Looks screen with sample extension imagery and booking, save and share controls',
      },
      {
        title: 'Discover your next appointment.',
        body: 'Explore looks across hair, barbering, nails, and more. Meet the professional behind each one.',
        src: asset('ios-discover'),
        alt: 'Tovis iOS Discover screen with sample extension, barbering and nail looks',
      },
    ],
    appNotes: [
      'For clients: inspiration with a path to the person who can bring it to life.',
      'For professionals: your work becomes an introduction. Your portfolio connects to the services you offer.',
      'Then keep building: visit notes, photos, and products give your next appointment context.',
    ],
    screenDisclosure:
      'Captured from Tovis iOS in the simulator. Sample profile and generated editorial images. Screen previews only; example looks are not bookable.',
    briefEyebrow: 'Got a photo? Start there.',
    briefTitle: 'You don’t need to know what it’s called.',
    briefIntro:
      'Bring the inspiration. Add what matters to you. Start a conversation with your professional.',
    briefPaperEyebrow: 'Your look, in your words',
    briefPaperTitle: 'The Look Brief',
    briefStarting: 'The starting point',
    briefExample: 'More length. A fuller finish. Still feels like me.',
    preferences: ['Low upkeep', 'Open to a change', 'Keep some length'],
    preferenceLabel: 'Example brief preferences',
    summaryLabel: 'What matters to me:',
    emptySummary: 'Choose what matters to you.',
    trustEyebrow: 'Less guessing.',
    trustItems: [
      {
        title: 'See their work.',
        body: 'Explore the looks, then get to know the professional behind them.',
      },
      {
        title: 'Talk through the details.',
        body: 'Check starting prices. Discuss the upkeep, timing, and what your look will take.',
      },
    ],
    proEyebrow: 'For the people behind the looks',
    proTitle: 'Your work. More eyes on it.',
    proIntro:
      'Get discovered for your craft. Build client relationships that last. Give your reputation room to grow.',
    proBenefits: [
      'Get discovered.',
      'Keep the connection.',
      'Build your name.',
    ],
    footerLinks: [
      { href: '/why', label: 'Pricing' },
      { href: '/about', label: 'About' },
      { href: '/support', label: 'Support' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/faq', label: 'FAQ' },
    ],
    smsLabel: 'SMS policy',
  }
}
