// app/privacy/page.tsx
//
// This page IS the app's privacy policy: tovis-ios links here
// (`TovisWebLinks.privacy` → `${host}/privacy`), it is the URL given to App
// Store Connect, and it is what an App Review reviewer opens.
//
// 🔴 It therefore has to describe everything the product actually collects. It
// once listed only "name, email, phone, role, signup location, booking/support
// information" while the app was also collecting photos, service addresses,
// client allergies and consent records, payment details via Stripe, messages
// and support threads — and sending photos to a third party for AI analysis.
// The App Privacy labels in tovis-ios `PrivacyInfo.xcprivacy` declare 13 data
// types; Apple compares those against this page, and a policy that says less
// than the labels is the inconsistency a reviewer flags.
//
// ⚠️ Every claim below is meant to match code, not aspiration. If a section
// stops being true, change the section — do not leave it as a promise the
// product does not keep. Copy is brand-resolved throughout so a white-label
// tenant renders its own name (check:no-hardcoded-brand-strings).
import Link from 'next/link'
import { buildTransactionalSmsPageCopy } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

export default async function PrivacyPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">Legal</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            This page explains what information {brand.displayName} collects and how it
            is used within the product.
          </p>
        </header>

        <div className="grid divide-y divide-textPrimary/8">

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Information we collect
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} collects the information you give us while using the
              product, and a small amount the product needs in order to work:
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-textSecondary">
              <li>
                <span className="text-textPrimary">Account details</span> — your name,
                email address, phone number and whether you use {brand.displayName} as a
                client or as a professional.
              </li>
              <li>
                <span className="text-textPrimary">Booking information</span> — the
                appointments you book or accept, the services involved, and the notes
                and messages exchanged about them.
              </li>
              <li>
                <span className="text-textPrimary">Addresses</span> — a professional’s
                business location, and, for an appointment that takes place at your own
                home, the service address you add.
              </li>
              <li>
                <span className="text-textPrimary">Approximate location</span> — if you
                allow it, so the app can show professionals near you. It is used to sort
                and filter results, never to follow your movements.
              </li>
              <li>
                <span className="text-textPrimary">Photos and the words around them</span>{' '}
                — appointment photos, portfolio posts, captions, comments and replies.
              </li>
              <li>
                <span className="text-textPrimary">Payment details</span> — handled by
                our payment processor, Stripe. See below.
              </li>
              <li>
                <span className="text-textPrimary">Support messages</span> — the subject
                and message you send us through the support form.
              </li>
              <li>
                <span className="text-textPrimary">Device and usage information</span> —
                a device identifier so we can send you the notifications you have turned
                on, and basic in-app activity such as which posts you have viewed, so the
                app can show you relevant content and we can see which features are used.
              </li>
            </ul>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Photos and AI analysis
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Photos you save to an appointment, a portfolio post or a consultation are
              stored with your {brand.displayName} account. A photo is shared with another
              person only where the product says it will be — with the professional you
              booked, or publicly if you choose to post it.
            </p>
            <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
              Some features use artificial intelligence. When you use the AI camera coach
              or an AI consultation, the photo is sent to Anthropic (the makers of Claude)
              to be analysed, and the app tells you before it happens. Photos sent for
              camera coaching are analysed in transit and are not stored for that purpose.
              Photos you upload as part of a consultation are kept with that consultation
              so you and your professional can refer back to them.
            </p>
            <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
              The camera also looks at the picture on your device — to find where a face
              or a body is in the frame, so it can tell you to move the phone. That
              happens entirely on your phone, it is not used to recognise or identify
              anyone, and it is never sent anywhere.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Client records kept by professionals
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              A professional can keep a record about a client, in the way a salon keeps a
              card on file. That record can include notes, colour formulas, appointment
              history, photos, signed consent forms, patch-test results and{' '}
              <span className="text-textPrimary">allergies</span>. Some of that is
              health-related information, and we treat it that way: it is visible to the
              client it belongs to and to the professional who recorded it, and it is not
              used for advertising, sold, or shared with anyone else.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Payments
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Payments are processed by Stripe. When you add or use a card, the card
              details go to Stripe directly — {brand.displayName} never receives or stores
              your full card number. We keep a record of what a booking cost and whether
              it was paid, so both sides of an appointment have the same history.
              Professionals who take card payments are onboarded by Stripe, which collects
              the identity and bank details it needs to pay them.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              How we use phone numbers
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {buildTransactionalSmsPageCopy(brand.displayName)}
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              No marketing SMS
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} sends transactional messages only. We do not send marketing
              or promotional SMS.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              No tracking, no advertising
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} does not track you across other companies’ apps or
              websites, does not show advertising, and does not sell your personal
              information. The information described on this page is used to run the
              product you are using.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Deleting your account
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              You can delete your {brand.displayName} account from inside the app — under
              Settings if you use it as a client, and under your profile tab if you use it
              as a professional. Deleting your account removes your profile and your
              personal information. A few records are kept: the financial record of a
              completed, paid appointment, which the other person to that appointment also
              needs and which we are required to keep, and a limited audit record of
              administrative actions.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Questions
            </h2>
            <p className="mb-5 text-[14px] leading-relaxed text-textSecondary">
              Use the support page for any privacy or account questions.
            </p>
            <Link
              href="/support"
              className="inline-flex items-center justify-center rounded-full border border-textPrimary/20 px-6 py-2.5 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/35 active:scale-[0.98]"
            >
              Contact Support →
            </Link>
          </section>

        </div>
      </div>
    </main>
  )
}
