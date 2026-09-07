import { editorialPrograms } from './editorialPrograms'
/** TOVIS campaign only; kept separate from white-label home copy. */
export function editorialSeo() {
  return {
    title: 'TOVIS — Beauty & Barber Booking App | San Diego',
    description:
      'Discover beauty looks and book hairstylists, barbers, nail techs and beauty professionals with TOVIS. Starting in San Diego. Explore the app and its pricing.',
    audienceTitle: 'Your look. Your people.',
    audienceBody:
      'TOVIS is a beauty discovery and booking app for clients and independent professionals. Explore hairstylists, barbers, nail techs, lash and brow artists, estheticians, makeup artists, and bridal professionals — starting in San Diego.',
    membershipOffer: { title: editorialPrograms.offerTitle, body: editorialPrograms.offerBody },
    faqTitle: 'A few things worth knowing.',
    questions: [
      {
        question: 'Newly licensed? Your first year is on us.',
        answer:
          editorialPrograms.newlyLicensed,
      },
      {
        question: 'How do Bookable Looks work?',
        answer:
          'A professional shares a completed service on the Looks feed with their client’s approval. When a look stops your scroll, tap Book to start with what you love about it. Together, we explore what caught your eye, where you’re starting, and the result you want — so you don’t have to know the service name. Your professional helps confirm the services and plan to work toward your goal look.',
      },
      {
        question: 'What is a client chart?',
        answer:
          'Your beauty history, remembered. Your client chart brings together your services, the process behind your results, the products you use, and any allergies, reactions, or treatment considerations you’ve shared. As you and your professionals add to it with each visit, it builds a clearer picture of what works for you — and what doesn’t. Your next professional can start with that understanding, helping them make more informed recommendations from your first appointment together. You don’t have to remember every treatment, product, or detail. TOVIS remembers with you.',
      },
      {
        question: 'What is the Look Brief?',
        answer:
          editorialPrograms.brief,
      },
      {
        question: 'Where is TOVIS starting?',
        answer:
          'Right here in San Diego — our founder’s hometown. She built TOVIS from her experience in the beauty industry and knows how much it matters to have a real person to talk to. Starting close to home lets her give our first professionals more one-on-one time: answering questions, hearing concerns, and helping them get started. The goal is personal support from someone who understands your work, with a conversation or an in-person visit close by.',
      },
      {
        question: 'What is the Founding 100?',
        answer:
          editorialPrograms.foundingBody,
      },
    ],
    priceQuestion: 'What does booking cost?',
  }
}
