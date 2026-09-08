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
    eyebrow: 'Beauty booking, made personal.',
    intro: 'Inside TOVIS, explore real work from hairstylists, barbers, nail techs, lash and brow artists, estheticians, makeup artists, and bridal professionals. When you find a look you love, meet the person who created it and start booking. Independent professionals get one place to be discovered, manage appointments, and keep client relationships growing. Starting in San Diego.',
    sticker: 'Start with the look you love.',
    nav: [
      { href: '#discovery', label: 'Explore looks' },
      { href: '#pros', label: 'For professionals' },
      { href: '#loop', label: 'Inside the app' },
    ],
    photos: [
      {
        src: asset('extensions-mirror-approved'),
        alt: 'Client and beauty professional together during an extension appointment',
        title: 'Long, blended extensions',
        category: 'Hair',
        label: 'Extensions',
        caption: 'A little more length.',
      },
      {
        src: asset('nails'),
        alt: 'Cobalt and silver nail art on short natural nails',
        title: 'Cobalt and silver nail art',
        category: 'Nails',
        label: 'Nails',
        caption: 'Color in the details.',
      },
      {
        src: asset('blonde'),
        alt: 'Laughing client with a softly layered copper bob',
        title: 'Copper bob with soft dimension',
        category: 'Hair',
        label: 'Color',
        caption: 'Warm copper, softly layered.',
      },
      {
        src: asset('brows'),
        alt: 'Client with shaped brows and subtle eye makeup',
        title: 'Defined brows and soft eye detail',
        category: 'Brows & lashes',
        label: 'Brows & lashes',
        caption: 'Details that feel like you.',
      },
      {
        src: asset('clipper-cut-approved'),
        alt: 'Barber using a guarded clipper to shape a textured cut',
        title: 'Textured cut with a clean finish',
        category: 'Barbering',
        label: 'Barbering',
        caption: 'Fresh shape, clean finish.',
      },
      {
        src: asset('curls'),
        alt: 'Client wearing defined natural curls with a rounded shape',
        title: 'Natural curls with shape',
        category: 'Hair',
        label: 'Curls',
        caption: 'A shape made for your texture.',
      },
    ],
    categories: ['All looks', 'Barbering', 'Hair', 'Nails', 'Brows & lashes'],
    discoveryEyebrow: 'The inspiration edit',
    discoveryTitle: 'Find a look that feels like you.',
    conceptLabel: 'Preview inspiration',
    saveLabel: 'Save',
    savedLabel: 'Saved',
    savedSuffix: 'saved in this preview',
    saveIntro: 'Save a little inspiration',
    disclosure:
      'Preview inspiration created for TOVIS. These are not client results or bookable looks. Anything you save here stays on this page.',
    appEyebrow: 'Inside the app',
    appTitle: 'See a look you love and meet the professional behind it.',
    screens: [
      {
        title: 'Browse real work.',
        body: 'Save looks from completed appointments and see the professional who created each one.',
        src: asset('ios-looks'),
        alt: 'Tovis iOS Looks screen with sample extension imagery and booking, save and share controls',
      },
      {
        title: 'Book from the look.',
        body: 'Start with the result you want, review the professional’s profile, and move into booking.',
        src: asset('ios-discover'),
        alt: 'Tovis iOS Discover screen with sample extension, barbering and nail looks',
      },
    ],
    appNotes: [
      'Clients can discover by style and result instead of trying to decode a service menu.',
      'Professionals can turn their portfolio into a direct path to their services and availability.',
      'After the appointment, visit notes, photos, aftercare, and product recommendations make the next visit easier.',
    ],
    screenDisclosure:
      'TOVIS iPhone preview with sample profiles and inspiration images. The sample looks shown here are not bookable.',
    briefEyebrow: 'Got a photo? Start there.',
    briefTitle: 'You don’t need to know what it’s called.',
    briefIntro:
      'Share the photo that inspired you, what you like about it, and what needs to work for your life. Your professional gets a clearer starting point before you meet.',
    briefPaperEyebrow: 'Your look, in your words',
    briefPaperTitle: 'The Look Brief',
    briefStarting: 'The starting point',
    briefExample: 'More length. A fuller finish. Still feels like me.',
    preferences: ['Low upkeep', 'Open to a change', 'Keep some length'],
    preferenceLabel: 'Example brief preferences',
    summaryLabel: 'What matters to me:',
    emptySummary: 'Choose what matters to you.',
    trustEyebrow: 'Why clients choose TOVIS',
    trustItems: [
      {
        title: 'Choose by the work, not just a star rating.',
        body: 'Explore results from completed appointments, then get to know the professional behind the look.',
      },
      {
        title: 'Book with a clearer idea of what to expect.',
        body: 'See starting prices, discuss timing and upkeep, and let your professional confirm the right service for your goal.',
      },
    ],
    proEyebrow: 'Why professionals choose TOVIS',
    proTitle: 'Let your work introduce you.',
    proIntro:
      'Clients see what you actually create and can move from a look to your profile, services, and availability. TOVIS also keeps booking, client context, aftercare, and retention tools together, so you can spend less time piecing systems together and more time building relationships.',
    proBenefits: [
      'Show clients what you do best.',
      'Turn interest into bookings.',
      'Give every client a reason to return.',
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
