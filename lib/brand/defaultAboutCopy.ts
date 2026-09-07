// lib/brand/defaultAboutCopy.ts
//
// User-facing copy for the public About page (app/about/page.tsx) and the
// "What is <brand>?" answer on the FAQ (app/faq/page.tsx). One factory, so the
// two pages describe the same product in the same words and cannot drift
// apart; before this they each carried their own paraphrase.
//
// The About page has two readers at once. A person deciding whether this is
// for them, and a carrier reviewer during toll-free / A2P verification (the
// page was born as a TFV trust page, da5bcb70). `intro` and `sections` are
// written for the first reader; `does` is the plain inventory for the second,
// and the SMS section on the page stays verbatim from
// lib/transactionalSmsPolicy, which is the copy the SMS program was approved
// against.
//
// Voice: the homepage's (lib/brand/defaultHomeCopy.ts). Short sentences, no em
// dashes, the brand name baked in from the tenant. Every capability named here
// is one the homepage already lists as live or rolling-out, and where the
// homepage states a limit (founder pilot, iPhone beta, payments rolling out)
// this page says it in the same breath. It deliberately carries no
// `state`/`evidence` fields of its own: it introduces no claim the homepage has
// not receipted, and a NEW claim goes there first, with its evidence line.

export interface BrandAboutCopy {
  /** Page heading. */
  title: string
  /** The one-paragraph answer the FAQ gives to "What is <brand>?". */
  summary: string
  /** The About page's opening, one string per paragraph. */
  intro: readonly string[]
  /** The three big-picture sections: clients, professionals, why it exists. */
  sections: readonly { label: string; title: string; body: string }[]
  /** Plain inventory of what the platform does, for a reviewer. */
  does: { title: string; body: string }
  /** Heading over the transactional-SMS disclosure. */
  smsTitle: string
}

/**
 * @param brandName the brand's DISPLAY name (e.g. "TOVIS"), not the lowercase
 * wordmark; it lands mid-sentence in prose.
 */
export function defaultAboutCopy(brandName: string): BrandAboutCopy {
  return {
    title: `What is ${brandName}?`,

    summary:
      `${brandName} is where your next look begins. Scroll real results from real appointments, tap the one you love, and book it, with the time held for you the moment you commit. Behind every look is a licensed professional, and behind every visit is a chart that remembers you, so the only appointment that ever starts from scratch is your first. For the professionals behind the looks, it is the whole business in one account: discovery that starts with your work, clients who come back, and no commissions.`,

    intro: [
      `${brandName} is where your next look begins. Scroll real results from real appointments, tap the one you love, and book it. The time is held for you the moment you commit. No menu to decode, no DM to a stranger, no receptionist in between.`,
      `Behind every look is a licensed professional. Behind every visit is a chart that remembers you: the products used, what worked and what did not, the photos from the day. So the only appointment that ever starts from scratch is your first.`,
    ],

    sections: [
      {
        label: 'For the person in the chair',
        title: 'You already know what you want to look like.',
        body:
          `You should not have to translate it into a service name. Browse looks by category, save the ones that stop you mid-scroll, and book the look itself, with a starting price right on it. Scout a new city before you land. Join a waitlist and get the first offer when a spot opens. Keep your aftercare, the products your professional recommended, and your next rebook in one place, so nothing gets forgotten. And when you have the photo but not the words, bring the photo: the smart consultation names the service and points you at the professional who can get you there. It is running with one professional today while the results are checked by hand.`,
      },
      {
        label: 'For the people behind the looks',
        title: 'Your work is your introduction.',
        body:
          `Every look you post is a front door. Clients find you by what you make, then book straight from it. Every client gets a chart: notes, allergies, photos, consent, visit history, so the relationship compounds with every appointment instead of starting over. Run the whole business from one account: your calendar, real availability, held slots, aftercare, expenses and a Schedule C at the end of the year. On iPhone, a camera that reads the light and coaches the shot like a photographer standing next to you, in beta now. And the money is yours. No commissions, no per-booking fee, and ${brandName} never holds your payout. Card payments through the platform are rolling out; until then you take payment the way you already do.`,
      },
      {
        label: 'Why it exists',
        title: 'Talent should not have to leave the industry to make a living.',
        body:
          `Too many gifted people walk away from beauty within a few years of finishing school. Not for lack of skill, but because the business side is brutal: empty chairs, no-shows, a notes app, a spreadsheet, and a social feed that never turns into a calendar. ${brandName} exists to change that. An independent chair, a suite, a mobile kit, a schedule that fits a life: those should be a career you can keep, not a gamble. When a professional's work can find its own clients, and every client can find the person who gets them, both sides win. That is the whole idea.`,
      },
    ],

    does: {
      title: `What ${brandName} does`,
      body:
        `Client and professional accounts. A feed of bookable looks with starting prices. Search by place and category. Booking, rescheduling, cancellation, and waitlists. Client charts with notes, visit history, photos, and consent. Aftercare with product recommendations and one-tap rebooking. Professional onboarding with license review. Expense and tax tracking for professionals. Public support intake.`,
    },

    smsTitle: `How ${brandName} uses SMS`,
  }
}
