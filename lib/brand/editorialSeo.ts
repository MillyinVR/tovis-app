import { editorialPrograms } from './editorialPrograms'
/** TOVIS campaign only; kept separate from white-label home copy. */
export function editorialSeo() {
  return {
    title: 'TOVIS | Beauty Booking for Clients & Professionals in San Diego',
    description:
      'TOVIS helps clients discover and book San Diego beauty professionals by their work, with tools that help independent professionals grow and retain clients.',
    areaServed: 'San Diego, California',
    organizationDescription:
      'TOVIS is a beauty discovery and booking platform for clients and independent beauty professionals, starting in San Diego.',
    audienceTitle: 'Beauty discovery and booking, built around the work.',
    audienceBody:
      'TOVIS is a beauty discovery and booking app for clients and independent professionals. Clients can explore real looks, meet the professional behind each one, review starting prices, and book without having to know the exact service name. Professionals can showcase their work, manage appointments, keep useful client context, share aftercare, and encourage repeat visits. TOVIS is starting with hairstylists, barbers, nail techs, lash and brow artists, estheticians, makeup artists, and bridal professionals in San Diego.',
    membershipOffer: { title: editorialPrograms.offerTitle, body: editorialPrograms.offerBody },
    faqTitle: 'Questions about TOVIS',
    questions: [
      {
        question: 'What is TOVIS?',
        answer:
          'TOVIS is a beauty discovery and booking app that connects clients with independent beauty professionals through the work they create. Clients can start with a look they love and find the professional behind it. Professionals can turn their portfolio into a path to their profile, services, availability, and booking.',
      },
      {
        question: 'Why would a client choose TOVIS?',
        answer:
          'TOVIS lets clients choose a professional by seeing real work from completed appointments. They can review starting prices, discuss what the look may require, book, join a waitlist, and keep aftercare and rebooking guidance in one place.',
      },
      {
        question: 'Why would a beauty professional choose TOVIS?',
        answer:
          'TOVIS helps independent professionals get discovered through their work and gives them tools for scheduling, deposits, client charts, aftercare, rebooking, retention, and last-minute openings. The essential booking tools are available without a monthly membership, and TOVIS does not take a commission from service revenue.',
      },
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
