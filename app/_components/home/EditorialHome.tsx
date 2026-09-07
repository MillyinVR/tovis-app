'use client'

import { useState, type ReactNode, type CSSProperties } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { BrandHomeCopy } from '@/lib/brand/types'
import type { EditorialCampaign } from '@/lib/brand/editorialCampaign'
import type { MarketingPricing } from '@/lib/brand/marketingPricing'
import CardPreview from './CardPreview'

export default function EditorialHome({
  copy,
  campaign: c,
  pricing,
  navigation,
  footer,
}: {
  copy: BrandHomeCopy
  campaign: EditorialCampaign
  pricing: MarketingPricing
  navigation: ReactNode
  footer: ReactNode
}) {
  const [category, setCategory] = useState(c.categories[0])
  const [saved, setSaved] = useState<string[]>([])
  const [screen, setScreen] = useState(0)
  const [preferences, setPreferences] = useState(c.preferences.slice(0, 1))
  const selectedScreen = c.screens[screen]
  const inspiration = c.photos[0]
  function toggle(
    value: string,
    values: string[],
    update: (next: string[]) => void,
  ) {
    update(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    )
  }
  const palette: CSSProperties & Record<`--eh-${string}`, string> = {
    '--eh-deep': c.palette.deep,
    '--eh-cream': c.palette.cream,
    '--eh-ink': c.palette.ink,
    '--eh-gold': c.palette.gold,
    '--eh-teal': c.palette.teal,
    '--eh-violet': c.palette.violet,
  }
  return (
    <div className="eh-home" style={palette}>
      <div className="eh-announcement">
        <span>{c.announcement}</span>
        <span>{c.strap}</span>
      </div>
      {navigation}
      <section className="eh-hero">
        <div className="eh-kicker">{c.eyebrow}</div>
        <h1>
          {copy.hero.headlineTop}
          <span>{copy.hero.headlineBottom}</span>
        </h1>
        <div className="eh-collage">
          {c.photos.slice(0, 4).map((photo, i) => (
            <figure className="eh-shot" key={photo.src}>
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                priority={i < 3}
                sizes="(max-width:650px) 33vw, 25vw"
              />
              <figcaption>{photo.caption}</figcaption>
            </figure>
          ))}
          <div className="eh-sticker">{c.sticker} ↙</div>
        </div>
        <div className="eh-hero-bottom">
          <p>{c.intro}</p>
          <div className="eh-actions">
            <Link href="/looks" className="eh-button eh-filled">
              {copy.hero.ctaClient} ↗
            </Link>
            <Link href="/signup/pro" className="eh-link">
              {copy.hero.ctaPro} →
            </Link>
          </div>
        </div>
        <p className="eh-disclosure">{copy.editorial.placeholderLabel}</p>
      </section>
      <section className="eh-section eh-explainer">
        <h2>{c.seo.audienceTitle}</h2>
        <p>{c.seo.audienceBody}</p>
      </section>
      <div className="eh-strip">
        {copy.editorial.categories.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <section id="loop" className="eh-section eh-app">
        <div className="eh-kicker">{c.appEyebrow}</div>
        <h2>{c.appTitle}</h2>
        <div className="eh-app-grid">
          <div>
            <div className="eh-screen-buttons">
              {c.screens.map((item, i) => (
                <button
                  key={item.src}
                  aria-pressed={screen === i}
                  onClick={() => setScreen(i)}
                >
                  <span>0{i + 1}</span>
                  <strong>{item.title}</strong>
                  <small>{item.body}</small>
                </button>
              ))}
            </div>
            <div className="eh-app-notes">
              {c.appNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
          <figure>
            <div className="eh-phone">
              {selectedScreen && (
                <Image
                  src={selectedScreen.src}
                  alt={selectedScreen.alt}
                  width={660}
                  height={1435}
                  sizes="330px"
                />
              )}
            </div>
            <figcaption className="eh-caption">{c.screenDisclosure}</figcaption>
          </figure>
        </div>
      </section>
      <section id="discovery" className="eh-section">
        <div className="eh-section-head">
          <div>
            <div className="eh-kicker">{c.discoveryEyebrow}</div>
            <h2>{c.discoveryTitle}</h2>
          </div>
          <p aria-live="polite">
            {saved.length ? `${saved.length} ${c.savedSuffix}` : c.saveIntro}
          </p>
        </div>
        <div className="eh-filters">
          {c.categories.map((item) => (
            <button
              key={item}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="eh-looks">
          {[...c.photos.slice(4, 5), ...c.photos.filter((_, i) => i !== 4)]
            .filter(
              (photo) =>
                category === c.categories[0] || photo.category === category,
            )
            .map((photo) => (
              <figure key={photo.src}>
                <div
                  className={`eh-look-image ${photo === c.photos[0] ? 'eh-mirror' : ''}`}
                >
                  <Image
                    src={photo.src}
                    alt={photo.alt}
                    fill
                    sizes="(max-width:650px) 50vw, 33vw"
                  />
                  <button
                    aria-label={`${saved.includes(photo.src) ? c.savedLabel : c.saveLabel} ${photo.title}`}
                    aria-pressed={saved.includes(photo.src)}
                    onClick={() => toggle(photo.src, saved, setSaved)}
                  >
                    {saved.includes(photo.src)
                      ? `${c.savedLabel} ✓`
                      : `${c.saveLabel} +`}
                  </button>
                  <span>{photo.label}</span>
                </div>
                <figcaption>
                  <h3>{photo.title}</h3>
                  <small>{c.conceptLabel}</small>
                </figcaption>
              </figure>
            ))}
        </div>
        <p className="eh-caption">{c.disclosure}</p>
      </section>
      <section className="eh-section eh-brief">
        <div>
          <div className="eh-kicker">{c.briefEyebrow}</div>
          <h2>{c.briefTitle}</h2>
          <p>{c.briefIntro}</p>
          <p className="eh-caption">{copy.editorial.journeyNote}</p>
        </div>
        <div className="eh-paper">
          <div className="eh-kicker">{c.briefPaperEyebrow}</div>
          <h3>{c.briefPaperTitle} ↗</h3>
          <div className="eh-brief-row">
            {inspiration && (
              <Image
                src={inspiration.src}
                alt={inspiration.alt}
                width={84}
                height={112}
              />
            )}
            <p>
              <strong>{c.briefStarting}</strong>
              <br />
              {c.briefExample}
            </p>
          </div>
          <div className="eh-preferences" aria-label={c.preferenceLabel}>
            {c.preferences.map((item) => (
              <button
                key={item}
                aria-pressed={preferences.includes(item)}
                onClick={() => toggle(item, preferences, setPreferences)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="eh-summary" aria-live="polite">
            {c.summaryLabel}{' '}
            <strong>
              {preferences.length ? preferences.join(' · ') : c.emptySummary}
            </strong>
          </div>
        </div>
      </section>
      <section id="clients" className="eh-section eh-trust">
        <div>
          <div className="eh-kicker">{c.trustEyebrow}</div>
          <h2>{copy.editorial.trustTitle}</h2>
        </div>
        {c.trustItems.map((item) => (
          <div key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        ))}
      </section>
      <section id="pros" className="eh-section eh-pro">
        <div>
          <div className="eh-kicker">{c.proEyebrow}</div>
          <h2>{c.proTitle}</h2>
          <p>{c.proIntro}</p>
          <Link href="/signup/pro" className="eh-button">
            {copy.hero.ctaPro} ↗
          </Link>
        </div>
        <ol>
          {c.proBenefits.map((item, i) => (
            <li key={item}>
              <span>0{i + 1}</span>
              {item}
            </li>
          ))}
        </ol>
      </section>
      <section id="retention" className="eh-section eh-retention">
        <div className="eh-kicker">{c.retention.eyebrow}</div>
        <h2>{c.retention.title}</h2>
        <p className="eh-retention-intro">{c.retention.intro}</p>
        <div className="eh-retention-grid">
          {c.retention.features.map((feature) => (
            <article key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
        <div className="eh-retention-opening">
          <h3>{c.retention.openingTitle}</h3>
          <p>{c.retention.openingIntro}</p>
          <ol>
            {c.retention.tiers.map((tier, index) => (
              <li key={tier.title}>
                <span className="eh-kicker">0{index + 1}</span>
                <h4>{tier.title}</h4>
                <p>{tier.body}</p>
              </li>
            ))}
          </ol>
          <p>{c.retention.openingNote}</p>
        </div>
        <p className="eh-retention-closer">{c.retention.closer}</p>
        <Link href="/signup/pro" className="eh-button eh-filled">{c.retention.cta} ↗</Link>
      </section>
      {copy.editorial.progression.length > 0 && (
        <section className="eh-section eh-program">
          <div className="eh-kicker">{copy.editorial.upcomingLabel}</div>
          <h2>{copy.editorial.foundingTitle}</h2>
          <p>{copy.editorial.foundingBody}</p>
          <p>{copy.editorial.foundingCard}</p>
          {copy.editorial.foundingPreview && (
            <CardPreview card={copy.editorial.foundingPreview} />
          )}
          <div className="eh-progression">
            {copy.editorial.progression.map((stage) => (
              <div key={stage}>
                <h3>{stage}</h3>
                {copy.editorial.progressionCards[stage] && (
                  <CardPreview card={copy.editorial.progressionCards[stage]} />
                )}
              </div>
            ))}
          </div>
          <p>{copy.editorial.progressionBody}</p>
        </section>
      )}
      <section className="eh-section eh-faq">
        <h2>{pricing.title}</h2>
        <p>{pricing.commission}</p>
        <p>{pricing.subscription}</p>
        <aside className="eh-membership-offer">
          <h3>{c.seo.membershipOffer.title}</h3>
          <p>{c.seo.membershipOffer.body}</p>
        </aside>
        <p>{pricing.professional}</p>
        <p>{pricing.client}</p>
        <Link className="eh-link" href="/why">
          {pricing.link} →
        </Link>
        <h2>{c.seo.faqTitle}</h2>
        {c.seo.questions.map((item) => (
          <details key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </section>
      {footer}
    </div>
  )
}
